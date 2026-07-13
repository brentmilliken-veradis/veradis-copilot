// Deterministic RNG — bit-exact port of NumPy 2.0.2's seeding + PCG64 + ziggurat
// samplers, per the Method v21 §7.3 deterministic-implementation contract:
// seed = SHA-256(objectId | snapshotTs | salt) first 8 bytes little-endian;
// numpy.random.Generator(numpy.random.PCG64(seed)) is the reference stream.
// Sources ported: numpy/random/bit_generator.pyx (SeedSequence),
// numpy/random/src/pcg64/pcg64.h (srandom + XSL-RR), and
// numpy/random/src/distributions/distributions.c (normal/exponential ziggurats).
// Parity is asserted against tests/golden/np-parity-vectors.json.

import { createHash } from "node:crypto";
import { SEED_SALT } from "./constants";
import {
  FE_DOUBLE,
  FI_DOUBLE,
  KE_DOUBLE,
  KI_DOUBLE,
  WE_DOUBLE,
  WI_DOUBLE,
  ZIGGURAT_EXP_R,
  ZIGGURAT_NOR_INV_R,
  ZIGGURAT_NOR_R,
} from "./ziggurat-tables";

const MASK64 = (1n << 64n) - 1n;
const MASK128 = (1n << 128n) - 1n;
const PCG_MULTIPLIER = 0x2360ed051fc65da44385df649fccf645n;
const TWO53 = 9007199254740992; // 2^53

// ---------------------------------------------------------------------------
// SeedSequence — numpy/random/bit_generator.pyx (uint32 arithmetic throughout)

const INIT_A = 0x43b0d7e5;
const MULT_A = 0x931e8875;
const INIT_B = 0x8b51f9dd;
const MULT_B = 0x58f38ded;
const MIX_MULT_L = 0xca01f9dd;
const MIX_MULT_R = 0x4973f715;
const XSHIFT = 16;
const POOL_SIZE = 4;

const u32 = (x: number) => x >>> 0;

class HashConst {
  constructor(public value: number) {}
}

function hashmix(value: number, hc: HashConst): number {
  value = u32(value ^ hc.value);
  hc.value = u32(Math.imul(hc.value, MULT_A));
  value = u32(Math.imul(value, hc.value));
  value = u32(value ^ (value >>> XSHIFT));
  return value;
}

function mix(x: number, y: number): number {
  let result = u32(Math.imul(MIX_MULT_L, x) - Math.imul(MIX_MULT_R, y));
  result = u32(result ^ (result >>> XSHIFT));
  return result;
}

/** numpy _int_to_uint32_array: little-endian 32-bit words, [0] for zero. */
function entropyWords(seed: bigint): number[] {
  if (seed === 0n) return [0];
  const words: number[] = [];
  let n = seed;
  while (n > 0n) {
    words.push(Number(n & 0xffffffffn));
    n >>= 32n;
  }
  return words;
}

/** SeedSequence(entropy).generate_state(nWords64, uint64). */
export function seedSequenceState64(seed: bigint, nWords64: number): bigint[] {
  const entropy = entropyWords(seed);
  const pool = new Array<number>(POOL_SIZE).fill(0);
  const hc = new HashConst(INIT_A);
  for (let i = 0; i < POOL_SIZE; i++) {
    pool[i] = hashmix(i < entropy.length ? entropy[i] : 0, hc);
  }
  for (let iSrc = 0; iSrc < POOL_SIZE; iSrc++) {
    for (let iDst = 0; iDst < POOL_SIZE; iDst++) {
      if (iSrc !== iDst) pool[iDst] = mix(pool[iDst], hashmix(pool[iSrc], hc));
    }
  }
  for (let iSrc = POOL_SIZE; iSrc < entropy.length; iSrc++) {
    for (let iDst = 0; iDst < POOL_SIZE; iDst++) {
      pool[iDst] = mix(pool[iDst], hashmix(entropy[iSrc], hc));
    }
  }
  // generate_state: uint32 stream cycling the pool, assembled LE into uint64s.
  const n32 = nWords64 * 2;
  const words32 = new Array<number>(n32);
  let hashConst = INIT_B;
  for (let i = 0; i < n32; i++) {
    let dataVal = pool[i % POOL_SIZE];
    dataVal = u32(dataVal ^ hashConst);
    hashConst = u32(Math.imul(hashConst, MULT_B));
    dataVal = u32(Math.imul(dataVal, hashConst));
    dataVal = u32(dataVal ^ (dataVal >>> XSHIFT));
    words32[i] = dataVal;
  }
  const out: bigint[] = [];
  for (let i = 0; i < nWords64; i++) {
    out.push(BigInt(words32[2 * i]) | (BigInt(words32[2 * i + 1]) << 32n));
  }
  return out;
}

// ---------------------------------------------------------------------------
// PCG64 — numpy pcg64.h setseq_128 XSL-RR, seeded exactly like numpy PCG64(seed)

function rotr64(v: bigint, rot: number): bigint {
  if (rot === 0) return v & MASK64;
  return ((v >> BigInt(rot)) | (v << BigInt(64 - rot))) & MASK64;
}

export class Pcg64 {
  private state = 0n;
  private inc = 0n;

  /** Mirrors numpy PCG64(seed): SeedSequence spreading then srandom. */
  constructor(seed: bigint) {
    const val = seedSequenceState64(seed, 4);
    const initstate = ((val[0] << 64n) | val[1]) & MASK128;
    const initseq = ((val[2] << 64n) | val[3]) & MASK128;
    this.inc = ((initseq << 1n) | 1n) & MASK128;
    this.state = 0n;
    this.step();
    this.state = (this.state + initstate) & MASK128;
    this.step();
  }

  private step(): void {
    this.state = (this.state * PCG_MULTIPLIER + this.inc) & MASK128;
  }

  /** Next 64-bit unsigned — numpy pcg_setseq_128_xsl_rr_64_random_r: step
   *  first, then XSL-RR of the NEW state. */
  next64(): bigint {
    this.step();
    const s = this.state;
    const rot = Number(s >> 122n);
    const xored = ((s >> 64n) ^ s) & MASK64;
    return rotr64(xored, rot);
  }

  /** Uniform in [0, 1) with 53 bits — numpy pcg64_next_double. */
  nextDouble(): number {
    return Number(this.next64() >> 11n) / TWO53;
  }

  /** numpy random_standard_normal — 256-layer ziggurat. */
  nextNormal(): number {
    for (;;) {
      let r = this.next64();
      const idx = Number(r & 0xffn);
      r >>= 8n;
      const sign = r & 1n;
      const rabs = (r >> 1n) & 0x000fffffffffffffn;
      let x = Number(rabs) * WI_DOUBLE[idx];
      if (sign & 1n) x = -x;
      if (rabs < KI_DOUBLE[idx]) return x;
      if (idx === 0) {
        for (;;) {
          const xx = -ZIGGURAT_NOR_INV_R * Math.log1p(-this.nextDouble());
          const yy = -Math.log1p(-this.nextDouble());
          if (yy + yy > xx * xx)
            return (rabs >> 8n) & 1n ? -(ZIGGURAT_NOR_R + xx) : ZIGGURAT_NOR_R + xx;
        }
      } else {
        if ((FI_DOUBLE[idx - 1] - FI_DOUBLE[idx]) * this.nextDouble() + FI_DOUBLE[idx] < Math.exp(-0.5 * x * x))
          return x;
      }
    }
  }

  /** numpy random_standard_exponential — 256-layer ziggurat. */
  nextExponential(): number {
    let ri = this.next64();
    ri >>= 3n;
    const idx = Number(ri & 0xffn);
    ri >>= 8n;
    const x = Number(ri) * WE_DOUBLE[idx];
    if (ri < KE_DOUBLE[idx]) return x;
    return this.exponentialUnlikely(idx, x);
  }

  private exponentialUnlikely(idx: number, x: number): number {
    if (idx === 0) {
      return ZIGGURAT_EXP_R - Math.log1p(-this.nextDouble());
    } else if ((FE_DOUBLE[idx - 1] - FE_DOUBLE[idx]) * this.nextDouble() + FE_DOUBLE[idx] < Math.exp(-x)) {
      return x;
    }
    return this.nextExponential();
  }
}

/** SHA-256(objectId | snapshotTs | salt); first 8 bytes little-endian → uint64. */
export function seedFromObject(objectId: string, snapshotTs: string, salt = SEED_SALT): { seed: bigint; hex: string } {
  const digest = createHash("sha256").update(`${objectId}|${snapshotTs}|${salt}`, "utf8").digest();
  let seed = 0n;
  for (let i = 0; i < 8; i++) seed |= BigInt(digest[i]) << BigInt(8 * i); // little-endian
  return { seed, hex: digest.toString("hex") };
}
