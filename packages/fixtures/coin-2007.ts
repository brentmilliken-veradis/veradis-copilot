// The 2007 Royal Canadian Mint Proof Set — the Phase A acceptance fixture
// (docs/fixtures/PCS-CA-2026-0007). Two snapshots encode the v01→v02 evidence
// ladder: v01 scores Silver (Custody thin, lower bound just misses Gold); v02,
// after the owner supplies the provenance narrative + receipt and the sealed
// state is documented, Custody rises and the set reaches Gold.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReportSnapshot, SnapshotCheck, SnapshotEvidence, Valuation } from "@/packages/pcs-types";
import { scoreFromRaws } from "@/packages/pcs-core";
import { sha256Hex } from "@/packages/util/hash";
import { sealVersion, hashSnapshot } from "@/packages/report/version";

export const COIN_OBJECT_ID = "PCS-CA-2026-0007";
const SNAPSHOT_TS = "2026-07-12T00:00:00Z";
const SCALE = 10; // coins — richest machine-readable data (§7.2 scale factor)

// Reverse-engineered from the fixture: Identity 95 / Material 95 / Risk 90 hold;
// Custody 64→91 is the ladder (provenance narrative + receipt moves it).
export const COIN_RAWS = {
  v1: { identity: 95, custody: 64, material: 95, risk: 90 },
  v2: { identity: 95, custody: 91, material: 95, risk: 90 },
} as const;

const PHOTO_FILES = [
  "IMG_2348.jpg", "IMG_2349.jpg", "IMG_2350.jpg", "IMG_2351.jpg", "IMG_2352.jpg",
  "IMG_2353.jpg", "IMG_2354.jpg", "IMG_2355.jpg", "IMG_2356.jpg",
];
const SLOTS = ["obverse", "reverse", "edge", "mintmark_macro", "slab_label", "extra_1", "extra_2", "extra_3", "extra_4"];

function photoEvidence(): SnapshotEvidence[] {
  return PHOTO_FILES.map((file, i) => {
    let sha256: string;
    try {
      const bytes = readFileSync(fileURLToPath(new URL(`../../docs/fixtures/PCS-CA-2026-0007/${file}`, import.meta.url)));
      sha256 = sha256Hex(bytes);
    } catch {
      sha256 = sha256Hex(file); // fallback if the image isn't present
    }
    return { slot: SLOTS[i] ?? `extra_${i}`, kind: "photo", sha256, c2paState: "absent", label: file };
  });
}

function checks(version: 1 | 2): SnapshotCheck[] {
  const identity: SnapshotCheck[] = [
    { quadrant: "identity", key: "country", label: "Country (Canada)", result: "match", authorityState: "resolved", sourceName: "Numista" },
    { quadrant: "identity", key: "denomination", label: "Denomination (Proof Set)", result: "match", authorityState: "resolved", sourceName: "PCGS" },
    { quadrant: "identity", key: "year", label: "Year (2007)", result: "match", authorityState: "resolved", sourceName: "PCGS" },
    { quadrant: "identity", key: "mint_mark", label: "Mint (RCM)", result: "match", authorityState: "resolved", sourceName: "Numista" },
    { quadrant: "identity", key: "variety", label: "Variety (Proof)", result: "observed", authorityState: "declared" },
  ];
  // Material characterisation — the label evolves declared → documented/sealed.
  const material: SnapshotCheck[] =
    version === 1
      ? [
          { quadrant: "material", key: "surface", label: "Surface & strike", result: "consistent", authorityState: "declared", note: "observed" },
          { quadrant: "material", key: "seal", label: "Mint seal", result: "observed", authorityState: "declared", note: "declared intact" },
        ]
      : [
          { quadrant: "material", key: "surface", label: "Surface & strike", result: "consistent", authorityState: "declared", note: "documented" },
          { quadrant: "material", key: "seal", label: "Mint seal", result: "consistent", authorityState: "declared", note: "sealed state documented + COA" },
        ];
  const custody: SnapshotCheck[] =
    version === 1
      ? [{ quadrant: "custody", key: "provenance", label: "Provenance", result: "gap_held_open", authorityState: "missing", note: "receipt not yet supplied" }]
      : [{ quadrant: "custody", key: "provenance", label: "Provenance narrative + receipt", result: "consistent", authorityState: "declared", note: "owner receipt supplied" }];
  const risk: SnapshotCheck[] = [
    { quadrant: "risk", key: "registries", label: "Stolen-property registries", result: "match", authorityState: "resolved", note: "no match on the check date" },
  ];
  return [...identity, ...custody, ...material, ...risk];
}

function valuation(version: 1 | 2): Valuation {
  const actionsV1 = [
    { rank: 1, action: "Supply the original purchase receipt", expectedBandEffect: "Custody +; may lift Silver→Gold" },
    { rank: 2, action: "Document the sealed mint state", expectedBandEffect: "Material confidence +" },
    { rank: 3, action: "Register the set to the veradis graph", expectedBandEffect: "Linked evidence for resale" },
  ];
  const actionsV2 = [
    { rank: 1, action: "Register the set to the veradis graph", expectedBandEffect: "Linked evidence for resale" },
    { rank: 2, action: "Do not break the mint seal — sealed state is material evidence", expectedBandEffect: "Breaking it lowers Material" },
  ];
  return {
    currency: "CAD",
    fmvLo: 135,
    fmvHi: 240,
    comps: [
      { source: "Heritage APR", venue: "Heritage Auctions", date: "2025-11", result: "CAD $240", basis: "sold" },
      { source: "PCGS APR", venue: "PCGS", date: "2025-09", result: "CAD $210", basis: "guide" },
      { source: "acsearch", venue: "acsearch.info", date: "2025-06", result: "CAD $135", basis: "sold" },
    ],
    factors: [{ name: "Sealed proof set", kind: "lift", effect: "premium to sealed examples" }],
    actions: version === 1 ? actionsV1 : actionsV2,
    marketInterest: "modest",
  };
}

function buildPlain(version: 1 | 2, opts: { provisional?: boolean } = {}): ReportSnapshot {
  const raws = version === 1 ? COIN_RAWS.v1 : COIN_RAWS.v2;
  const score = scoreFromRaws(raws, {
    objectId: COIN_OBJECT_ID,
    snapshotTs: version === 1 ? SNAPSHOT_TS : `${SNAPSHOT_TS}#v2`,
    scaleFactor: SCALE,
    withheldDisclosure: false,
    materialMissingWeight: 0,
  });

  const attrs = { country: "Canada", denomination: "Proof Set", year: "2007", mint_mark: "RCM", variety: "Proof" };
  return {
    reportId: COIN_OBJECT_ID,
    objectId: COIN_OBJECT_ID,
    snapshotTs: version === 1 ? SNAPSHOT_TS : `${SNAPSHOT_TS}#v2`,
    category: "coins",
    v: version,
    methodVersion: "v21",
    meta: { effectiveDate: "2026-07-12", ownerLocale: "en-CA", currency: "CAD", basis: "Documentary" },
    object: { title: "2007 Royal Canadian Mint Proof Set", ownerFacingName: "2007 Royal Canadian Mint Proof Set", declaredAttributes: attrs, resolvedAttributes: attrs },
    evidence: photoEvidence(),
    checks: checks(version),
    citations: [
      { name: "PCGS", url: "https://pcgs.com", retrievalState: "retrieved", tier: 1 },
      { name: "Numista", url: "https://numista.com", retrievalState: "retrieved", tier: 1 },
    ],
    corrections: [],
    score,
    valuation: valuation(version),
    narrative: [
      { id: "summary", title: "Summary", body: "A sealed 2007 Royal Canadian Mint proof set, verified against the documentary record and expert-reviewed." },
    ],
    provisional: opts.provisional ?? false,
    delta:
      version === 2
        ? [
            { measure: "PCS score", from: "85", to: "93", note: "Silver → Gold" },
            { measure: "Custody", from: "64", to: "91", note: "provenance narrative + receipt supplied" },
            { measure: "Material characterisation", from: "declared", to: "documented / sealed", note: "COA + sealed state" },
            { measure: "Ranked actions", from: "three", to: "two", note: "gaps closed" },
          ]
        : undefined,
  };
}

/** Build a sealed 2007-coin snapshot. v02 chains onto v01's content hash. */
export function buildCoin2007(version: 1 | 2, opts: { provisional?: boolean } = {}): ReportSnapshot {
  if (version === 1) return sealVersion(buildPlain(1, opts));
  const predecessor = hashSnapshot(buildPlain(1));
  return sealVersion(buildPlain(2, opts), predecessor);
}
