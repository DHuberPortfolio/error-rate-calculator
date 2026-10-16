// The math behind the calculator. No dependencies; runs in the browser
// (as window.ErrorRange) and in Node (require('./stats.js')) so the same
// code the page uses is the code the tests check.
//
// All rates here are proportions (0.06 means 6%). The page turns them into
// percentages for display.

(function (root) {
  'use strict';

  // 95% confidence. Same value as workflow-eval-harness, so both tools
  // report identical ranges for the same counts.
  const Z = 1.96;

  // Largest sample recordsNeeded() will search before giving up.
  const MAX_RECORDS = 1000000;

  function checkCounts(wrong, tested) {
    if (!Number.isInteger(tested) || tested < 1) {
      throw new RangeError('tested must be a whole number of at least 1');
    }
    if (!Number.isInteger(wrong) || wrong < 0 || wrong > tested) {
      throw new RangeError('wrong must be a whole number from 0 to tested');
    }
  }

  // Upper and lower ends of the Wilson score interval for an observed rate p
  // over n records. Split out from wilson() so recordsNeeded() can ask "what
  // would the range be at a bigger n?" without inventing whole-number counts.
  function wilsonBounds(p, n) {
    const z2 = Z * Z;
    const denom = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denom;
    const half = (Z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom;
    return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
  }

  // The likely range of the real error rate, given `wrong` mistakes in
  // `tested` records.
  //
  // Wilson's method, not the textbook "p +/- 1.96 * sqrt(p(1-p)/n)": the
  // textbook formula says 0 mistakes in 7 records has a range of exactly
  // 0% to 0%, which is the overconfidence this tool exists to expose.
  function wilson(wrong, tested) {
    checkCounts(wrong, tested);
    const rate = wrong / tested;
    const { low, high } = wilsonBounds(rate, tested);
    return { rate, low, high };
  }

  // Did a change (new prompt, new model, new rule) really move the error
  // rate, or could the difference be luck?
  //
  // Newcombe's method 10 (1998): builds the range for the difference out of
  // the two Wilson ranges. drop = before - after, so a positive drop means
  // fewer mistakes. If the whole range is above zero, the improvement is
  // real at 95%; if it straddles zero, the data can't tell yet.
  function compare(before, after) {
    const b = wilson(before.wrong, before.tested);
    const a = wilson(after.wrong, after.tested);
    const drop = b.rate - a.rate;
    const low = drop - Math.sqrt((b.rate - b.low) ** 2 + (a.high - a.rate) ** 2);
    const high = drop + Math.sqrt((b.high - b.rate) ** 2 + (a.rate - a.low) ** 2);
    let verdict = 'unclear';
    if (low > 0) verdict = 'better';
    else if (high < 0) verdict = 'worse';
    // Checking whether the two ranges overlap is a common shortcut, and a
    // too-cautious one: ranges can overlap while the drop is still real.
    const rangesOverlap = b.low <= a.high && a.low <= b.high;
    return { before: b, after: a, drop, low, high, verdict, rangesOverlap };
  }

  function checkPlan(rate, target) {
    if (!(target > 0 && target < 1)) {
      throw new RangeError('target must be between 0 and 1');
    }
    if (!(rate >= 0 && rate <= 1)) {
      throw new RangeError('rate must be between 0 and 1');
    }
  }

  // ---- same examples both times (paired) ----
  //
  // When both versions ran on the same records, the records that came out
  // the same carry no information about the change. Only two counts do:
  // fixed (wrong before, right after) and broke (right before, wrong after).
  // The drop in the error rate is exactly (fixed - broke) / tested.
  //
  // Range for that drop: Tango's score interval (1998), the paired twin of
  // the Wilson range: both come from turning a score test inside out. Its
  // verdict agrees with McNemar's test, the standard before/after test on
  // the same items, and depends only on fixed and broke.

  // Tango's score statistic for "the real drop is d". Larger when the data
  // sit above d; it falls as d rises.
  function tangoScore(fixed, broke, tested, d) {
    const num = fixed - broke - tested * d;
    if (num === 0) return 0;
    // The most likely "broke" probability if the real drop were d (the
    // constrained maximum-likelihood estimate): a root of a quadratic.
    const a = 2 * tested;
    const b = -fixed - broke + (2 * tested - fixed + broke) * d;
    const c = -broke * d * (1 - d);
    const q = (Math.sqrt(Math.max(0, b * b - 4 * a * c)) - b) / (2 * a);
    const variance = tested * (2 * q + d * (1 - d));
    if (!(variance > 0)) return num > 0 ? Infinity : -Infinity;
    return num / Math.sqrt(variance);
  }

  // The d where the score crosses `level`, between lo and hi (score falls
  // as d rises). Halving the gap 200 times is far past double precision.
  function crossing(fixed, broke, tested, level, lo, hi) {
    for (let i = 0; i < 200 && hi - lo > 1e-15; i++) {
      const mid = (lo + hi) / 2;
      if (tangoScore(fixed, broke, tested, mid) > level) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // The likely range of the real drop, from the paired counts alone.
  function pairedDifference(fixed, broke, tested) {
    if (!Number.isInteger(tested) || tested < 1) {
      throw new RangeError('tested must be a whole number of at least 1');
    }
    if (!Number.isInteger(fixed) || !Number.isInteger(broke) || fixed < 0 || broke < 0 || fixed + broke > tested) {
      throw new RangeError('fixed and broke must be whole numbers that fit in tested');
    }
    const drop = (fixed - broke) / tested;
    const low = tangoScore(fixed, broke, tested, -1) <= Z ? -1 : crossing(fixed, broke, tested, Z, -1, drop);
    const high = tangoScore(fixed, broke, tested, 1) >= -Z ? 1 : crossing(fixed, broke, tested, -Z, drop, 1);
    return { drop, low, high };
  }

  // Did the change help, when both versions ran on the same records?
  // Takes the before count and the two kinds of change; the after count
  // follows (wrong before - fixed + broke). Same verdicts as compare().
  function comparePaired({ tested, wrongBefore, fixed, broke }) {
    checkCounts(wrongBefore, tested);
    if (!Number.isInteger(fixed) || fixed < 0 || fixed > wrongBefore) {
      throw new RangeError('fixed must be a whole number from 0 to wrongBefore');
    }
    if (!Number.isInteger(broke) || broke < 0 || broke > tested - wrongBefore) {
      throw new RangeError('broke must be a whole number from 0 to the records right before');
    }
    const before = wilson(wrongBefore, tested);
    const after = wilson(wrongBefore - fixed + broke, tested);
    const { drop, low, high } = pairedDifference(fixed, broke, tested);
    let verdict = 'unclear';
    if (low > 0) verdict = 'better';
    else if (high < 0) verdict = 'worse';
    const rangesOverlap = before.low <= after.high && after.low <= before.high;
    return { before, after, drop, low, high, verdict, rangesOverlap };
  }

  // Smallest total number of records whose likely range sits entirely below
  // `target`, if mistakes turn up at exactly `rate`.
  //
  // This is the break-even point, not a plan: a real test at that size
  // lands under the target only about half the time (audit/accuracy.js
  // measured 42-92%), because the next sample's rate wobbles around `rate`.
  // planTest() below is the plan. This stays because a perfect run (rate 0)
  // has no wobble: it is the hard minimum anyone needs.
  //
  // Returns null when rate >= target: no amount of testing shows a rate is
  // under a target it is already at or above. Returns Infinity when the
  // answer is above MAX_RECORDS (rate just under target).
  //
  // A plain count upward: obviously finds the smallest answer, and a
  // million steps of this arithmetic takes milliseconds.
  function recordsNeeded(rate, target) {
    checkPlan(rate, target);
    if (rate >= target) return null;
    for (let n = 1; n <= MAX_RECORDS; n++) {
      if (wilsonBounds(rate, n).high < target) return n;
    }
    return Infinity;
  }

  // ---- exact binomial chances, for planning ----

  // logFactorial[i] = ln(i!), grown on demand.
  const logFactorial = [0, 0];
  function lnFact(n) {
    for (let i = logFactorial.length; i <= n; i++) logFactorial.push(logFactorial[i - 1] + Math.log(i));
    return logFactorial[n];
  }

  // Probability of at most k mistakes in n records when the real rate is p.
  // Each term is worked in logarithms so big n can't underflow to zero.
  function chanceAtMost(k, n, p) {
    if (k < 0) return 0;
    if (k >= n || p === 0) return 1;
    const lp = Math.log(p), lq = Math.log1p(-p), ln = lnFact(n);
    let total = 0;
    for (let i = 0; i <= k; i++) total += Math.exp(ln - lnFact(i) - lnFact(n - i) + i * lp + (n - i) * lq);
    return Math.min(1, total);
  }

  // Most mistakes n records can contain and still have their whole likely
  // range under target (-1 if even zero mistakes isn't enough). More
  // mistakes always push the range up, so it is a count from below.
  function mostMistakesAllowed(n, target, from) {
    let k = from === undefined ? -1 : from;
    while (k + 1 <= n && wilsonBounds((k + 1) / n, n).high < target) k++;
    return k;
  }

  // Exact chance that testing n records, at a real rate of `rate`, gives a
  // likely range entirely under `target`.
  function chanceOfShowing(n, rate, target) {
    checkPlan(rate, target);
    return chanceAtMost(mostMistakesAllowed(n, target), n, rate);
  }

  // z for the planning chances on offer (the normal curve's quantiles).
  const Z_FOR_CHANCE = { 0.8: 0.8416212335729143, 0.9: 1.2815515655446004, 0.95: 1.6448536269514722 };

  // Above this estimate, plans use the textbook formula alone; the exact
  // search would take too long to run on every keystroke, and at that size
  // the formula's error is small.
  const EXACT_PLAN_LIMIT = 5000;

  // How many records to test to show the real rate is under `target`,
  // with at least `chance` probability, if the real rate is `rate`.
  //
  // Starts from the textbook estimate (the normal approximation behind the
  // Wilson range), then checks the exact chance at every size up to double
  // that estimate. The answer is one past the last size that falls short,
  // so it holds for testing that many records or more. "Or more" matters:
  // whole-number mistake counts make the chance zigzag as n grows, so the
  // first size to reach `chance` can dip below it again a few records later.
  //
  // Returns { n, chance, exact }: chance is the exact probability at n
  // (null when exact is false), or null when rate >= target.
  function planTest(rate, target, chance) {
    if (chance === undefined) chance = 0.8;
    checkPlan(rate, target);
    const zb = Z_FOR_CHANCE[chance];
    if (zb === undefined) throw new RangeError('chance must be 0.8, 0.9 or 0.95');
    if (rate >= target) return null;
    if (rate === 0) return { n: recordsNeeded(0, target), chance: 1, exact: true };

    const est = ((Z * Math.sqrt(target * (1 - target)) + zb * Math.sqrt(rate * (1 - rate))) / (target - rate)) ** 2;
    if (est > EXACT_PLAN_LIMIT) return { n: Math.ceil(est), chance: null, exact: false };

    // If a size near the end still falls short, the estimate was low: keep
    // checking further out, so the answer always has clear room after it.
    let limit = Math.max(2 * Math.ceil(est), Math.ceil(est) + 100);
    let lastShort = 0, k = -1;
    const chances = [];
    for (let n = 1; n <= limit; n++) {
      k = mostMistakesAllowed(n, target, k);
      chances[n] = chanceAtMost(k, n, rate);
      if (chances[n] < chance) {
        lastShort = n;
        if (n > limit / 2) limit = 2 * n;
      }
    }
    return { n: lastShort + 1, chance: chances[lastShort + 1], exact: true };
  }

  // How many records to test on EACH version to see a real change between
  // two rates, with about `chance` probability, if those are the real rates.
  //
  // The textbook formula for comparing two rates (Fleiss, equal sizes,
  // two-sided 5%). Approximate: the exact chance it delivers for compare()
  // is measured in audit/accuracy.js.
  //
  // Returns null when the rates are equal: there's no change to look for.
  function perVersionForChange(rateBefore, rateAfter, chance) {
    if (chance === undefined) chance = 0.8;
    const zb = Z_FOR_CHANCE[chance];
    if (zb === undefined) throw new RangeError('chance must be 0.8, 0.9 or 0.95');
    if (rateBefore === rateAfter) return null;
    const mean = (rateBefore + rateAfter) / 2;
    const top = Z * Math.sqrt(2 * mean * (1 - mean)) +
      zb * Math.sqrt(rateBefore * (1 - rateBefore) + rateAfter * (1 - rateAfter));
    return Math.ceil((top / (rateBefore - rateAfter)) ** 2);
  }

  // How many records to test (the same ones on both versions) to see a
  // change, with about `chance` probability, if the change keeps fixing
  // `rateFixed` and breaking `rateBroke` of them.
  //
  // The textbook formula for McNemar's test (Connor 1987). Approximate: the
  // exact chance it delivers is measured in audit/accuracy.js.
  //
  // Returns null when fixed and broke are equal: no change to look for.
  function pairedForChange(rateFixed, rateBroke, chance) {
    if (chance === undefined) chance = 0.8;
    const zb = Z_FOR_CHANCE[chance];
    if (zb === undefined) throw new RangeError('chance must be 0.8, 0.9 or 0.95');
    if (rateFixed === rateBroke) return null;
    const changed = rateFixed + rateBroke, drop = rateFixed - rateBroke;
    const top = Z * Math.sqrt(changed) + zb * Math.sqrt(changed - drop * drop);
    return Math.ceil((top / drop) ** 2);
  }

  const api = {
    Z, MAX_RECORDS, EXACT_PLAN_LIMIT,
    wilson, compare, recordsNeeded, chanceOfShowing, planTest, perVersionForChange,
    tangoScore, pairedDifference, comparePaired, pairedForChange,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ErrorRange = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
