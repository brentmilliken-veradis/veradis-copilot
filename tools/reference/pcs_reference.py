#!/usr/bin/env python3
"""Canonical NumPy reference for the PCS confidence interval — Method v21 §7.

Implements §7.2 (beta-binomial quadrant posterior, Jeffreys prior, Material
variance inflation) and §7.3 (10'000-draw Monte-Carlo composite, PCG64,
Generator.beta = Cheng BB/BC, linear-interpolation quantiles, SHA-256 seed
contract) exactly as written. Mandated by §7.3's deterministic-implementation
contract and §13 ("Implementers must include the SHA-256 of the canonical
NumPy reference output for the §12 test cases in tests/golden/").

Acceptance target: the §12.1–§12.7 composite CI bounds printed in the spec.
This script is NOT tuned to match the TypeScript engine in packages/pcs-core.

n_eff interpretations evaluated (§7.2: n_eff = Σ check.weight × scaleFactor):
  A "spec-literal"  — quadrant-internal weights sum to 1.0 (§2 identity
                      inventories are locked sum-to-1; §4 material thresholds
                      imply the same; custody/risk carry no defined weights,
                      so Σ = 1). n_eff = scaleFactor.
  B "count-based"   — every check/event in the §12 case tables carries
                      weight 1.0; n_eff = (#checks) × scaleFactor.
  C "solve"         — invert the doc's §12 composite CI to the implied n_eff
                      (uniform across quadrants) — diagnostic only.

Usage:
  python tools/reference/pcs_reference.py            # full report, all cases
  python tools/reference/pcs_reference.py --golden   # also write tests/golden/
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# §1 / §7.3 — LOCKED cross-quadrant weights.
WEIGHTS = {"identity": 0.30, "custody": 0.30, "material": 0.25, "risk": 0.15}
QUADRANTS = ("identity", "custody", "material", "risk")
DRAWS = 10_000
JEFFREYS = (0.5, 0.5)
SEED_SALT = "pcs-v01"
TIER_BANDS = {"gold": 80, "silver": 60, "bronze": 40}


def seed_from_object(object_id: str, snapshot_ts: str, salt: str = SEED_SALT) -> int:
    """§7.3 seed contract: SHA-256(objectId|snapshotTs|salt), first 8 bytes LE uint64."""
    digest = hashlib.sha256(f"{object_id}|{snapshot_ts}|{salt}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "little")


def quadrant_posterior(raw: float, n_eff: float, is_material: bool, missing_weight: float) -> tuple[float, float]:
    """§7.2 — Beta(prior.a + successes, prior.b + failures); Material variance
    inflation preserves the mean while dividing (kappa+1) by the factor."""
    successes = (raw / 100.0) * n_eff
    failures = n_eff - successes
    alpha = JEFFREYS[0] + successes
    beta = JEFFREYS[1] + failures
    if is_material and missing_weight > 0:
        inflation = 1.0 + 2.0 * missing_weight
        mu = alpha / (alpha + beta)
        kappa = alpha + beta
        kappa2 = max((kappa + 1.0) / inflation - 1.0, 1e-3)
        alpha, beta = mu * kappa2, (1.0 - mu) * kappa2
    return alpha, beta


def composite_ci(posteriors: dict[str, tuple[float, float]], seed: int, draws: int = DRAWS) -> dict:
    """§7.3 — weighted sum of per-quadrant Generator.beta draws; linear quantiles."""
    rng = np.random.Generator(np.random.PCG64(seed))
    samples = np.zeros(draws)
    for _ in range(0):  # placeholder to keep draw order explicit below
        pass
    for i in range(draws):
        s = 0.0
        for q in QUADRANTS:  # fixed order: identity, custody, material, risk
            a, b = posteriors[q]
            s += WEIGHTS[q] * rng.beta(a, b)
        samples[i] = s * 100.0
    point = float(np.mean(samples))
    lo = float(np.quantile(samples, 0.025))  # method='linear' is the default
    hi = float(np.quantile(samples, 0.975))
    return {"point": point, "lo": lo, "hi": hi, "level": 0.95}


def tier_from_lo(lo: float, flagged_override: bool = False) -> str:
    if flagged_override or lo < TIER_BANDS["bronze"]:
        return "flagged"
    if lo >= TIER_BANDS["gold"]:
        return "gold"
    if lo >= TIER_BANDS["silver"]:
        return "silver"
    return "bronze"


@dataclass
class Case:
    key: str
    name: str
    raws: dict[str, float]
    scale: float
    missing_weight: float
    # checks per quadrant as printed in the §12 input tables (for scenario B)
    check_counts: dict[str, int]
    doc_ci: tuple[float, float]
    doc_composite: float
    doc_tier: str


# §12 cases. check_counts = the number of input rows the §12 tables list per
# quadrant (identity attributes / custody events / material checks / risk = 1).
CASES = [
    Case("12.1", "AP Royal Oak 5516", {"identity": 96, "custody": 91, "material": 95, "risk": 90}, 10, 0.1,
         {"identity": 7, "custody": 4, "material": 4, "risk": 1}, (88, 96), 93.35, "gold"),
    Case("12.2", "Omega Speedmaster 145.022", {"identity": 98, "custody": 64, "material": 92, "risk": 90}, 10, 0.0,
         {"identity": 7, "custody": 5, "material": 5, "risk": 1}, (78, 90), 85.10, "silver"),
    Case("12.3", "Lee-Enfield No.4 Mk 1", {"identity": 97, "custody": 96, "material": 94, "risk": 100}, 5, 0.0,
         {"identity": 6, "custody": 4, "material": 5, "risk": 1}, (92, 98), 96.40, "gold"),
    Case("12.4", "Porsche 911 Carrera RS", {"identity": 95, "custody": 78, "material": 73, "risk": 100}, 3, 0.0,
         {"identity": 6, "custody": 6, "material": 4, "risk": 1}, (76, 90), 85.15, "silver"),
    Case("12.5", "Rolex Submariner 5513", {"identity": 94, "custody": 58, "material": 85, "risk": 90}, 10, 0.0,
         {"identity": 7, "custody": 6, "material": 5, "risk": 1}, (73, 87), 80.35, "silver"),
    Case("12.6", "Tudor Submariner 7928", {"identity": 58, "custody": 51, "material": 65, "risk": 90}, 10, 0.0,
         {"identity": 7, "custody": 3, "material": 5, "risk": 1}, (51, 73), 62.45, "bronze"),
    Case("12.7", "fake Daytona 6263", {"identity": 28, "custody": 22, "material": 0, "risk": 90}, 10, 0.0,
         {"identity": 4, "custody": 2, "material": 5, "risk": 1}, (18, 39), 28.50, "flagged"),
]


def composite_point(raws: dict[str, float]) -> float:
    return round(sum(WEIGHTS[q] * raws[q] for q in QUADRANTS), 2)


def run_case(case: Case, n_eff_by_q: dict[str, float], object_id: str, snapshot_ts: str) -> dict:
    posteriors = {
        q: quadrant_posterior(case.raws[q], n_eff_by_q[q], q == "material", case.missing_weight)
        for q in QUADRANTS
    }
    seed = seed_from_object(object_id, snapshot_ts)
    ci = composite_ci(posteriors, seed)
    # Reproducibility contract (HoI ruling, 13 Jul 2026): CI bounds are reported
    # and hashed at 2 dp, round-half-even on the exact value (f"{x:.2f}").
    # Full-precision floats are libm/platform-tainted and stay OUT of the golden.
    ci_2dp = {k: float(f"{ci[k]:.2f}") for k in ("point", "lo", "hi")}
    return {
        "posteriors": {q: {"alpha": posteriors[q][0], "beta": posteriors[q][1]} for q in QUADRANTS},
        "n_eff": n_eff_by_q,
        "seed": seed,
        "ci": ci,
        "ci_2dp": ci_2dp,
        "composite_algebraic": composite_point(case.raws),
        # Tier maps on the ROUNDED lower bound — the contract value.
        "tier_on_mc_lo": tier_from_lo(ci_2dp["lo"], flagged_override=case.key == "12.7"),
    }


def solve_n_eff(case: Case, snapshot_ts: str, lo_target: float, hi_target: float) -> float:
    """Diagnostic: bisect a uniform n_eff (same across quadrants, ×scale already
    folded in) whose MC CI width best matches the doc's width."""
    target_width = hi_target - lo_target

    def width(n: float) -> float:
        n_eff = {q: n for q in QUADRANTS}
        r = run_case(case, n_eff, f"solve-{case.key}", snapshot_ts)
        return r["ci"]["hi"] - r["ci"]["lo"]

    lo_n, hi_n = 2.0, 4000.0
    for _ in range(40):
        mid = (lo_n * hi_n) ** 0.5
        if width(mid) > target_width:
            lo_n = mid
        else:
            hi_n = mid
    return (lo_n * hi_n) ** 0.5


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--golden", action="store_true", help="write tests/golden/ outputs")
    parser.add_argument("--case", default=None, help="run a single case key, e.g. 12.1")
    args = parser.parse_args()

    snapshot_ts = "2026-07-13T00:00:00Z"
    report: dict[str, dict] = {}
    for case in CASES:
        if args.case and case.key != args.case:
            continue
        object_id = f"§{case.key} {case.name}"

        scen_a = run_case(case, {q: case.scale * 1.0 for q in QUADRANTS}, object_id, snapshot_ts)
        scen_b = run_case(
            case, {q: case.scale * case.check_counts[q] for q in QUADRANTS}, object_id, snapshot_ts
        )
        implied_n = solve_n_eff(case, snapshot_ts, *case.doc_ci)

        report[case.key] = {
            "name": case.name,
            "doc": {"composite": case.doc_composite, "ci": list(case.doc_ci), "tier": case.doc_tier},
            "scenario_A_spec_literal": scen_a,
            "scenario_B_count_based": scen_b,
            "implied_uniform_n_eff_for_doc_width": round(implied_n, 1),
        }

    print(json.dumps(report, indent=1))

    if args.golden:
        golden_dir = Path(__file__).resolve().parents[2] / "tests" / "golden"
        golden_dir.mkdir(parents=True, exist_ok=True)
        # Golden = the CONTRACT values only: CI bounds at 2 dp round-half-even,
        # tier on the rounded lower bound, plus the platform-independent inputs
        # (posteriors, n_eff, seeds). Full-precision CI floats are libm-tainted
        # (they differ ~1 ulp across platform libms) and are deliberately kept
        # out of the hashed file so regeneration reproduces on ANY platform.
        contract_fields = ("ci_2dp", "tier_on_mc_lo", "posteriors", "n_eff", "seed")
        golden = {
            "generator": "tools/reference/pcs_reference.py",
            "numpy": np.__version__,
            "contract": "Method v21 §7.2–§7.3; scenarios A (n_eff = Σweights(=1.0) × scale) and B (n_eff = #checks × scale)",
            "contract_precision": "CI bounds at 2 dp, round-half-even on the exact value; tier maps on the rounded lower bound (HoI ruling 13 Jul 2026)",
            "binding_scenario": "B — count-based n_eff, ratified by Head of Intelligence 13 Jul 2026 (see docs/20260713_INT_BRIEF_PCS-CI-Neff-ScenarioB-Ratification_v01.md)",
            "snapshot_ts": snapshot_ts,
            "cases": {
                k: {
                    "doc": v["doc"],
                    "composite_algebraic": v["scenario_A_spec_literal"]["composite_algebraic"],
                    "scenario_A_spec_literal": {
                        s: v["scenario_A_spec_literal"][s] for s in contract_fields
                    },
                    "scenario_B_count_based": {
                        s: v["scenario_B_count_based"][s] for s in contract_fields
                    },
                }
                for k, v in report.items()
            },
        }
        payload = json.dumps(golden, indent=1, sort_keys=True)
        out = golden_dir / "pcs-golden-v21.json"
        out.write_text(payload, encoding="utf-8")
        sha = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        (golden_dir / "pcs-golden-v21.sha256").write_text(sha + "\n", encoding="utf-8")
        print(f"\ngolden written: {out}\nsha256: {sha}", file=sys.stderr)


if __name__ == "__main__":
    main()
