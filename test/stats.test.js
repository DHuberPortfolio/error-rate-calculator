// Every expected number below was worked out before the code was written:
// by hand, then confirmed by a separate Python calculation, and (where
// marked) against the published tables in Newcombe's 1998 papers, which
// are where these methods are defined.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  wilson, compare, recordsNeeded, chanceOfShowing, planTest, perVersionForChange, EXACT_PLAN_LIMIT,
  tangoScore, pairedDifference, comparePaired, pairedForChange, Z,
} = require('../stats.js');

// Within half a unit of the last decimal place the source printed.
function near(actual, expected, places) {
  const tol = 0.5 * 10 ** -places;
  assert.ok(Math.abs(actual - expected) <= tol,
    `expected ${expected} (to ${places} places), got ${actual}`);
}

test('the worked example: 3 wrong out of 50 is really 2.1% to 16.2%', () => {
  const r = wilson(3, 50);
  near(r.rate, 0.06, 4);
  near(r.low, 0.020615, 6);
  near(r.high, 0.162173, 6);
});

test('a headline like 7.2% on 500 records is really about 5.2% to 9.8%', () => {
  const r = wilson(36, 500);
  near(r.low, 0.052458, 6);
  near(r.high, 0.098069, 6);
});

test('matches Newcombe (1998), single proportion, Wilson score method', () => {
  // [wrong, tested, published low, published high], printed to 4 places.
  const published = [
    [81, 263, 0.2553, 0.3662],
    [15, 148, 0.0624, 0.1605],
    [0, 20, 0.0000, 0.1611],
    [1, 29, 0.0061, 0.1718],
  ];
  for (const [k, n, low, high] of published) {
    const r = wilson(k, n);
    near(r.low, low, 4);
    near(r.high, high, 4);
  }
});

test('zero mistakes never means a range of exactly zero', () => {
  // The textbook formula's failure: 0 of 7 -> "0% to 0%". Wilson says the
  // real rate could be as high as about 35%.
  const r = wilson(0, 7);
  assert.equal(r.low, 0);
  assert.ok(r.high > 0.3, `high end should be well above zero, got ${r.high}`);
});

test('all wrong stays inside 0% to 100%', () => {
  const r = wilson(50, 50);
  assert.equal(r.high, 1);
  near(r.low, 0.928650, 6);
});

test('impossible counts are refused, not guessed at', () => {
  assert.throws(() => wilson(1, 0), RangeError);
  assert.throws(() => wilson(5, 4), RangeError);
  assert.throws(() => wilson(-1, 10), RangeError);
  assert.throws(() => wilson(1.5, 10), RangeError);
});

test('compare matches Newcombe (1998), difference of proportions, method 10', () => {
  const c = compare({ wrong: 56, tested: 70 }, { wrong: 48, tested: 80 });
  near(c.drop, 0.2, 4);
  near(c.low, 0.0524, 4);
  near(c.high, 0.3339, 4);
  assert.equal(c.verdict, 'better');
});

test('overlapping ranges can still hide a real improvement', () => {
  // 24% -> 8% on 50 records each. The two ranges (14.3-37.4% and
  // 3.2-18.8%) overlap, yet the drop's own range, 1.5 to 30.3 points,
  // is entirely above zero.
  const c = compare({ wrong: 12, tested: 50 }, { wrong: 4, tested: 50 });
  assert.equal(c.rangesOverlap, true);
  near(c.low, 0.014530, 6);
  near(c.high, 0.302612, 6);
  assert.equal(c.verdict, 'better');
});

test('no change gives a range centred on zero and an unclear verdict', () => {
  const c = compare({ wrong: 3, tested: 50 }, { wrong: 3, tested: 50 });
  near(c.low, -0.109502, 6);
  near(c.high, 0.109502, 6);
  assert.equal(c.verdict, 'unclear');
});

test('a change that made things worse is called worse', () => {
  const c = compare({ wrong: 4, tested: 50 }, { wrong: 12, tested: 50 });
  assert.equal(c.verdict, 'worse');
  assert.ok(c.high < 0);
});

test('a perfect run needs 73 records to show the rate is under 5%', () => {
  // At 72 records with no mistakes the range tops out at 5.07%;
  // at 73 it tops out at 4.9994%.
  assert.equal(recordsNeeded(0, 0.05), 73);
  assert.equal(recordsNeeded(0, 0.01), 381);
});

test('records needed when some mistakes are turning up', () => {
  assert.equal(recordsNeeded(0.06, 0.10), 217);
  assert.equal(recordsNeeded(0.02, 0.05), 203);
  assert.equal(recordsNeeded(0.072, 0.10), 441);
});

test('more testing cannot show a rate is under a target it already meets or beats', () => {
  assert.equal(recordsNeeded(0.06, 0.05), null);
  assert.equal(recordsNeeded(0.05, 0.05), null);
});

test('a rate just under the target needs more records than the search allows', () => {
  assert.equal(recordsNeeded(0.0499, 0.05), Infinity);
});

test('records needed refuses targets outside 0-100%', () => {
  assert.throws(() => recordsNeeded(0, 0), RangeError);
  assert.throws(() => recordsNeeded(0, 1), RangeError);
});

// ---- planning: the fix for step 2 ----

test('the break-even count is close to a coin flip, which is why it is not the plan', () => {
  // 217 is where 6% sits just under 10%. A fresh test of 217 at a real
  // rate of 6% lands under 10% only when it has 13 mistakes or fewer.
  // audit/accuracy.js adds that up independently and gets the same 57.08%.
  near(chanceOfShowing(217, 0.06, 0.10), 0.570812, 6);
});

test('the 80% plan for 6% against a 10% target is 398 examples', () => {
  const plan = planTest(0.06, 0.10);
  assert.equal(plan.n, 398);
  assert.equal(plan.exact, true);
  near(plan.chance, 0.835939, 6);
  // One fewer falls short, so the plan isn't padded.
  assert.ok(chanceOfShowing(397, 0.06, 0.10) < 0.8);
});

test('the plan holds for that many examples or more', () => {
  // The chance zigzags as the sample grows; the plan must clear 80% at
  // every size after it, not just at the size itself.
  for (const [p, t] of [[0.06, 0.10], [0.02, 0.05], [0.01, 0.10], [0.10, 0.20]]) {
    const { n } = planTest(p, t);
    for (let m = n; m <= 2 * n; m++) {
      assert.ok(chanceOfShowing(m, p, t) >= 0.8, `${p} vs ${t}: ${m} examples is below 80%`);
    }
  }
});

test('a higher chance asks for more examples', () => {
  assert.equal(planTest(0.06, 0.10, 0.9).n, 514);
  assert.ok(planTest(0.06, 0.10, 0.95).n > 514);
});

test('a perfect run plans to the hard minimum', () => {
  assert.deepEqual(planTest(0, 0.05), { n: 73, chance: 1, exact: true });
});

test('plans that would be huge fall back to the textbook formula, and say so', () => {
  const plan = planTest(0.049, 0.05);
  assert.equal(plan.exact, false);
  assert.equal(plan.chance, null);
  assert.ok(plan.n > EXACT_PLAN_LIMIT);
});

test('planning refuses what it cannot promise', () => {
  assert.equal(planTest(0.06, 0.05), null);
  assert.throws(() => planTest(0.02, 0.05, 0.7), RangeError);
});

// ---- planning: how many per version to see a change ----

test('82 per version to see 24% -> 8% with an 80% chance', () => {
  // Worked by hand: mean 16%; 1.96 * sqrt(2 * .16 * .84) = 1.01618;
  // 0.84162 * sqrt(.24 * .76 + .08 * .92) = 0.42583; (1.44201 / .16)^2 = 81.2.
  assert.equal(perVersionForChange(0.24, 0.08), 82);
  assert.equal(perVersionForChange(0.08, 0.24), 82);
});

test('no change seen means nothing to plan for', () => {
  assert.equal(perVersionForChange(0.1, 0.1), null);
});

// ---- same examples both times (paired) ----

test('paired range matches the published worked example (Fagerland 2014, Tango score)', () => {
  // 21 pairs: fixed 1, broke 7. Reference values printed by the R package
  // ratesci for Fagerland, Lydersen & Laake (2014): -0.5172 to -0.0260.
  const r = pairedDifference(1, 7, 21);
  near(r.drop, -0.2857, 4);
  near(r.low, -0.5172, 4);
  near(r.high, -0.0260, 4);
});

test('at the ends of the range, the score is exactly 1.96', () => {
  // That is what defines a 95% score interval; worked by hand for the
  // published example first (1.9597 and -1.9600 at the printed bounds).
  for (const [f, b, n] of [[1, 7, 21], [12, 3, 80], [0, 4, 30], [9, 9, 200]]) {
    const r = pairedDifference(f, b, n);
    if (r.low > -1) near(tangoScore(f, b, n, r.low), Z, 9);
    if (r.high < 1) near(tangoScore(f, b, n, r.high), -Z, 9);
  }
});

// Independent check of the formula's trickiest step: Tango's score needs the
// most likely "broke" probability under each candidate drop, which stats.js
// gets from a quadratic. Here it's found by brute force instead: search for
// the peak of the likelihood directly.
function bruteScore(fixed, broke, n, d) {
  const logLik = (q) => (fixed ? fixed * Math.log(q + d) : 0) + (broke ? broke * Math.log(q) : 0) +
    (n - fixed - broke ? (n - fixed - broke) * Math.log(1 - 2 * q - d) : 0);
  let lo = Math.max(0, -d) + 1e-15, hi = (1 - d) / 2 - 1e-15;
  for (let i = 0; i < 300; i++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (logLik(m1) < logLik(m2)) lo = m1; else hi = m2;
  }
  const q = (lo + hi) / 2;
  return (fixed - broke - n * d) / Math.sqrt(n * (2 * q + d * (1 - d)));
}

test('the quadratic shortcut agrees with a brute-force likelihood search', () => {
  for (const [f, b, n] of [[1, 7, 21], [12, 3, 80], [5, 0, 40], [0, 6, 25], [30, 20, 500]]) {
    for (const d of [-0.6, -0.3, -0.1, -0.02, 0.03, 0.15, 0.4]) {
      if (Math.abs(f - b - n * d) < 1e-12) continue;
      near(tangoScore(f, b, n, d), bruteScore(f, b, n, d), 6);
    }
  }
});

test('nothing changed in 50 examples still leaves a range of 7.1 points either way', () => {
  // Worked by hand: with no changed examples the score is -sqrt(50d/(1-d)),
  // which reaches -1.96 at d = 3.8416 / 53.8416 = 0.071350: the same number
  // as the top of the Wilson range for 0 of 50.
  const r = pairedDifference(0, 0, 50);
  near(r.high, 0.071350, 6);
  near(r.low, -0.071350, 6);
  near(r.high, wilson(0, 50).high, 12);
});

test('only the examples that changed decide the verdict (McNemar boundary)', () => {
  // (fixed - broke) / sqrt(fixed + broke) must pass 1.96:
  // 6 vs 1 gives 1.89 (can't tell), 7 vs 1 gives 2.12 (real improvement),
  // however many examples came out the same.
  for (const tested of [20, 50, 500]) {
    assert.equal(comparePaired({ tested, wrongBefore: 10, fixed: 6, broke: 1 }).verdict, 'unclear');
    assert.equal(comparePaired({ tested, wrongBefore: 10, fixed: 7, broke: 1 }).verdict, 'better');
    assert.equal(comparePaired({ tested, wrongBefore: 10, fixed: 1, broke: 7 }).verdict, 'worse');
  }
});

test('swapping fixed and broke mirrors the range', () => {
  for (const [f, b, n] of [[1, 7, 21], [12, 3, 80], [0, 4, 30]]) {
    const r = pairedDifference(f, b, n), m = pairedDifference(b, f, n);
    near(r.low, -m.high, 9);
    near(r.high, -m.low, 9);
  }
});

test('the matched check spots a change that separate-tests math cannot', () => {
  // 24% -> 10% on the same 50 examples: fixed 8, broke 1.
  const p = comparePaired({ tested: 50, wrongBefore: 12, fixed: 8, broke: 1 });
  near(p.after.rate, 0.10, 9);
  assert.equal(p.verdict, 'better');
  assert.equal(compare({ wrong: 12, tested: 50 }, { wrong: 5, tested: 50 }).verdict, 'unclear');
});

test('paired counts that cannot happen are refused', () => {
  assert.throws(() => comparePaired({ tested: 50, wrongBefore: 5, fixed: 6, broke: 0 }), RangeError);
  assert.throws(() => comparePaired({ tested: 50, wrongBefore: 45, fixed: 0, broke: 6 }), RangeError);
  assert.throws(() => pairedDifference(30, 30, 50), RangeError);
});

test('108 examples to see a change that fixes 12% and breaks 2%', () => {
  // Worked by hand: 1.96 * sqrt(.14) + 0.84162 * sqrt(.14 - .01)
  // = 0.73337 + 0.30344 = 1.03681; 1.03681^2 / .1^2 = 107.5.
  assert.equal(pairedForChange(0.12, 0.02), 108);
  assert.equal(pairedForChange(0.02, 0.12), 108);
  assert.equal(pairedForChange(0.05, 0.05), null);
});
