"""Check 1: does stats.js compute the same ranges as an established library?

Runs the shipped stats.js (through dump-js.js) over about 70,000 inputs and
compares every range with statsmodels, a widely used Python statistics
library written independently of this project:

  - proportion_confint(method="wilson")        vs  wilson()
  - confint_proportions_2indep(method="newcomb") vs  compare()

One known, deliberate difference: statsmodels turns "95%" into
z = 1.959964 (the exact 97.5th percentile of the normal curve); this
calculator and workflow-eval-harness use the conventional 1.96. So the check
runs twice:

  1. The proof: statsmodels is given the confidence level whose z is exactly
     1.96. Same inputs, same z, so any difference is a formula difference,
     and the allowance is a billionth (floating-point rounding only).
  2. For information: statsmodels at its own 95%, showing how far the two
     conventions move the numbers and how often the number the page shows
     (one decimal) would come out 0.1 different.

Same examples both times (paired mode) has no statsmodels interval, so it is
checked two other ways:

  3. Its verdict against statsmodels' McNemar test, the standard
     before/after test on the same items. Tango's range excludes zero
     exactly when McNemar's (uncorrected) statistic passes 1.96 squared.
  4. Its range against a second implementation of Tango's method written
     here, which finds the most likely "broke" probability by numerical
     search instead of stats.js's quadratic formula: same method, no
     shared code.

Run from the repo root:  .venv\\Scripts\\python audit\\reference_check.py
"""

import json
import math
import subprocess
import sys
from pathlib import Path

from scipy.optimize import brentq
from scipy.stats import norm
from statsmodels.stats.contingency_tables import mcnemar
from statsmodels.stats.proportion import confint_proportions_2indep, proportion_confint

ROOT = Path(__file__).resolve().parent.parent
ALPHA_Z196 = 2 * norm.sf(1.96)  # the alpha whose two-sided z is exactly 1.96
TOLERANCE = 1e-9


def shown(x):
    """The number the page displays: a percentage to one decimal."""
    return f"{x * 100:.1f}"


def compare_all(js, alpha):
    """Largest difference and count of shown-number differences, per method."""
    worst_single, shown_single = 0.0, 0
    for k, n, low, high in js["single"]:
        ref_low, ref_high = proportion_confint(k, n, alpha=alpha, method="wilson")
        ref_low, ref_high = max(0.0, ref_low), min(1.0, ref_high)
        worst_single = max(worst_single, abs(low - ref_low), abs(high - ref_high))
        shown_single += shown(low) != shown(ref_low) or shown(high) != shown(ref_high)

    worst_pair, shown_pair = 0.0, 0
    for k1, n1, k2, n2, low, high in js["pairs"]:
        ref_low, ref_high = confint_proportions_2indep(k1, n1, k2, n2, method="newcomb",
                                                       compare="diff", alpha=alpha)
        worst_pair = max(worst_pair, abs(low - ref_low), abs(high - ref_high))
        shown_pair += shown(low) != shown(ref_low) or shown(high) != shown(ref_high)
    return worst_single, shown_single, worst_pair, shown_pair


def tango_score(fixed, broke, n, d):
    """Tango's score for "the real drop is d", with the most likely broke
    probability found by root-finding on the likelihood's slope."""
    num = fixed - broke - n * d
    if num == 0:
        return 0.0
    rest = n - fixed - broke

    def slope(q):
        s = 0.0
        if fixed:
            s += fixed / (q + d)
        if broke:
            s += broke / q
        if rest:
            s -= 2 * rest / (1 - 2 * q - d)
        return s

    lo, hi = max(0.0, -d), (1 - d) / 2
    a, b = lo + 1e-13, hi - 1e-13
    if a >= b or slope(a) <= 0:
        q = lo
    elif slope(b) >= 0:
        q = hi
    else:
        q = brentq(slope, a, b, xtol=1e-16, maxiter=500)
    variance = n * (2 * q + d * (1 - d))
    if variance <= 0:
        return math.inf if num > 0 else -math.inf
    return num / math.sqrt(variance)


def tango_range(fixed, broke, n, z=1.96):
    drop = (fixed - broke) / n
    edge = 1 - 1e-12
    low = -1.0 if tango_score(fixed, broke, n, -edge) <= z else \
        brentq(lambda d: tango_score(fixed, broke, n, d) - z, -edge, drop, xtol=1e-15)
    high = 1.0 if tango_score(fixed, broke, n, edge) >= -z else \
        brentq(lambda d: tango_score(fixed, broke, n, d) + z, drop, edge, xtol=1e-15)
    return low, high


def check_paired(js):
    """Verdict vs statsmodels' McNemar, and range vs the second implementation."""
    verdict_disagree, worst_range = 0, 0.0
    for fixed, broke, n, low, high in js["paired"]:
        js_says_change = low > 0 or high < 0
        if fixed + broke == 0:
            mcnemar_says_change = False
        else:
            stat = mcnemar([[0, fixed], [broke, 0]], exact=False, correction=False).statistic
            mcnemar_says_change = stat > 1.96 ** 2
        verdict_disagree += js_says_change != mcnemar_says_change
        ref_low, ref_high = tango_range(fixed, broke, n)
        worst_range = max(worst_range, abs(low - ref_low), abs(high - ref_high))
    return verdict_disagree, worst_range


def main():
    out = subprocess.run(["node", str(ROOT / "audit" / "dump-js.js")],
                         capture_output=True, text=True, check=True)
    js = json.loads(out.stdout)
    n_single, n_pair = len(js["single"]), len(js["pairs"])

    ws, ss, wp, sp = compare_all(js, ALPHA_Z196)
    print(f"1. Same z (1.96), the proof")
    print(f"   Likely range (Wilson):       {n_single:>6,} inputs, largest difference {ws:.1e}, shown number differs in {ss}")
    print(f"   Before vs. after (Newcombe): {n_pair:>6,} inputs, largest difference {wp:.1e}, shown number differs in {sp}")
    ok = ws <= TOLERANCE and wp <= TOLERANCE and ss == 0 and sp == 0

    ws, ss, wp, sp = compare_all(js, 0.05)
    print(f"2. statsmodels' own 95% (z = 1.959964), for information")
    print(f"   Likely range (Wilson):       largest difference {ws * 100:.4f} percentage points, "
          f"shown number 0.1 different in {ss} of {n_single:,} ({ss / n_single:.2%})")
    print(f"   Before vs. after (Newcombe): largest difference {wp * 100:.4f} percentage points, "
          f"shown number 0.1 different in {sp} of {n_pair:,} ({sp / n_pair:.2%})")

    n_paired = len(js["paired"])
    disagree, worst = check_paired(js)
    print(f"3. Same examples both times: verdict vs statsmodels' McNemar test")
    print(f"   {n_paired:,} inputs, verdicts that disagree: {disagree}")
    print(f"4. Same examples both times: range vs a second implementation (numerical search)")
    print(f"   {n_paired:,} inputs, largest difference {worst:.1e}")
    paired_ok = disagree == 0 and worst <= 1e-9

    print("PASS: identical to statsmodels at the same z" if ok
          else f"FAIL: stats.js and statsmodels disagree at the same z")
    print("PASS: paired verdicts match McNemar, ranges match the second implementation" if paired_ok
          else "FAIL: paired mode disagrees with a reference")
    sys.exit(0 if ok and paired_ok else 1)


if __name__ == "__main__":
    main()
