// @veradis/pcs-types (co-pilot, standalone) — the app-level domain contract.
//
// NOTE (reconciliation): the platform package @veradis/pcs-types
// (dev/veradis-platform/packages/pcs-types) is zod-based, watch-centric
// (Domain = horology|military|automotive) and uses UPPERCASE tiers. This
// co-pilot model is category-agnostic (5 categories, coins-first) and uses
// lowercase tiers + camelCase. Reconcile the two when the co-pilot graduates
// to the monorepo (see docs/…P0-Build-Plan). Method v21 constants (weights,
// tier bands, seed salt "pcs-v01") are shared and encoded in packages/pcs-core.

export * from "./domain";
export * from "./profiles";
export * from "./scoring";
export * from "./snapshot";
