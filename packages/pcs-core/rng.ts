// Deterministic RNG — PCG64 (O'Neill 2014), honouring the Method v21 §7.3 seed
// contract: SHA-256 over `objectId | snapshotTs | "pcs-v01"`, first 8 bytes as a
// little-endian uint64 = the seed. Same (objectId, snapshotTs) ⇒ identical stream
// ⇒ scores reproduce to the digit.

import { createHash } from "node:crypto";
import { SEED_SALT } from "./constants";

const MASK64 = (1n << 64n) - 1n;
const MASK128 = (1n << 128n) - 1n;
const MULTIPLIER = 0x2360ed051fc65da44385df649fccf645n;
const INCREMENT = 0x5851f42d4c957f2d14057b7ef767814fn;
const TWO53 = 9007199254740992; // 2^53

function rotr64(v: bigint, rot: number): bigint {
  if (rot === 0) return v & MASK64;
  return ((v >> BigInt(rot)) | (v << BigInt(64 - rot))) & MASK64;
}

export class Pcg64 {
  private state = 0n;
  private hasSpare = false;
  private spare = 0;

  constructor(seed: bigint) {
    this.state = 0n;
    this.step();
    this.state = (this.state + (seed & MASK128)) & MASK128;
    this.step();
  }

  private step(): void {
    this.state = (this.state * MULTIPLIER + INCREMENT) & MASK128;
  }

  /** Next 64-bit unsigned (XSL-RR output of the current state, then advance). */
  next64(): bigint {
    const s = this.state;
    this.step();
    const rot = Number((s >> 122n) & 0x3fn);
    const xored = ((s >> 64n) ^ s) & MASK64;
    return rotr64(xored, rot);
  }

  /** Uniform in [0, 1) with 53 bits of entropy. */
  nextDouble(): number {
    return Number(this.next64() >> 11n) / TWO53;
  }

  /** Standard normal via Box–Muller (deterministic, cached pair). */
  nextNormal(): number {
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spare;
    }
    let u1 = this.nextDouble();
    const u2 = this.nextDouble();
    if (u1 < 1e-12) u1 = 1e-12;
    const mag = Math.sqrt(-2 * Math.log(u1));
    this.spare = mag * Math.sin(2 * Math.PI * u2);
    this.hasSpare = true;
    return mag * Math.cos(2 * Math.PI * u2);
  }
}

/** SHA-256(objectId | snapshotTs | salt); first 8 bytes little-endian → uint64. */
export function seedFromObject(objectId: string, snapshotTs: string, salt = SEED_SALT): { seed: bigint; hex: string } {
  const digest = createHash("sha256").update(`${objectId}|${snapshotTs}|${salt}`, "utf8").digest();
  let seed = 0n;
  for (let i = 0; i < 8; i++) seed |= BigInt(digest[i]) << BigInt(8 * i); // little-endian
  return { seed, hex: digest.toString("hex") };
}
