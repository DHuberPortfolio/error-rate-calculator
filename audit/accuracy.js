// Check 2: are the calculator's promises true?
//
// Matching another library (reference_check.py) proves the formulas are
// typed in correctly. It does not prove the formulas keep their promises.
// This script tests the promises themselves, against true error rates we
// set, using the exact binomial distribution: for a real rate p and n
// examples, the chance of seeing each possible number of mistakes is known
// exactly, so "how often is the calculator right?" can be added up exactly,
// with no simulation noise.
//
// Every answer comes from the shipped stats.js.
//
// Run from the repo root:  node audit/accuracy.js            (markdown tables)
//                          node audit/accuracy.js --json     (raw numbers)

const {
  wilson, compare, recordsNeeded, planTest, perVersionForChange, pairedDifference, pairedForChange,
} = require('../stats.js');

// ---- exact binomial probabilities ----

const MAX_N = 12000;
const LOG_FACT = new Float64Array(MAX_N + 1);
for (let i = 2; i <= MAX_N; i++) LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i);

// chance[k] = probability of exactly k mistakes in n examples at real rate p.
function chances(n, p) {
  const out = new Float64Array(n + 1);
  if (p === 0) { out[0] = 1; return out; }
  const lp = Math.log(p), lq = Math.log1p(-p);
  for (let k = 0; k <= n; k++) {
    out[k] = Math.exp(LOG_FACT[n] - LOG_FACT[k] - LOG_FACT[n - k] + k * lp + (n - k) * lq);
  }
  return out;
}

const rangesCache = new Map();
function rangesFor(n) {
  if (!rangesCache.has(n)) {
    const r = [];
    for (let k = 0; k <= n; k++) r.push(wilson(k, n));
    rangesCache.set(n, r);
  }
  return rangesCache.get(n);
}

// ---- 1. Does the likely range contain the real rate 95% of the time? ----
//
// A miss can happen two ways, and they are not equally bad for an error rate:
//   too high: the whole range sits above the real rate. It overstates the
//             mistakes. Annoying, but the safe side.
//   too low:  the whole range sits below the real rate. It understates the
//             mistakes, the way a silent error does. The risky side.
// A 95% range should miss about 2.5% of the time on each side.

function rangeAccuracy(n, p) {
  const c = chances(n, p), ranges = rangesFor(n);
  let tooHigh = 0, tooLow = 0;
  for (let k = 0; k <= n; k++) {
    if (ranges[k].low > p) tooHigh += c[k];
    else if (ranges[k].high < p) tooLow += c[k];
  }
  return { contains: 1 - tooHigh - tooLow, tooHigh, tooLow };
}

const SIZES = [10, 20, 30, 50, 100, 200, 500, 1000];
// Every real rate from 0.1% to 50% in steps of 0.1%; error rates above 50%
// mirror these (a 70% error rate is a 30% success rate).
const RATES = Array.from({ length: 500 }, (_, i) => (i + 1) / 1000);

// Where AI error rates usually sit, for a second, narrower summary.
const TYPICAL = (p) => p >= 0.01 && p <= 0.30;

function rangeTable() {
  return SIZES.map((n) => {
    const rows = RATES.map((p) => ({ p, ...rangeAccuracy(n, p) }));
    const typical = rows.filter((r) => TYPICAL(r.p));
    const avg = rows.reduce((s, r) => s + r.contains, 0) / rows.length;
    const worst = rows.reduce((a, b) => (b.contains < a.contains ? b : a));
    const riskiest = rows.reduce((a, b) => (b.tooLow > a.tooLow ? b : a));
    const riskiestTypical = typical.reduce((a, b) => (b.tooLow > a.tooLow ? b : a));
    const share = (f) => rows.filter(f).length / rows.length;
    return {
      n,
      average_contains: avg,
      worst_contains: worst.contains, worst_at: worst.p, worst_too_high: worst.tooHigh,
      share_below_93: share((r) => r.contains < 0.93),
      worst_too_low: riskiest.tooLow, worst_too_low_at: riskiest.p,
      worst_too_low_typical: riskiestTypical.tooLow, worst_too_low_typical_at: riskiestTypical.p,
      share_too_low_over_5: share((r) => r.tooLow > 0.05),
    };
  });
}

// ---- 2. Does testing "this many examples" deliver what it says? ----
//
// Step 2 tells you how many examples to test so the whole likely range
// lands under your target, if mistakes keep turning up at the rate seen so
// far. Here the real rate IS the rate seen so far; we test that many fresh
// examples and add up how often the range really does land under the target.

const PLANS = [];
for (const target of [0.05, 0.10, 0.15, 0.20]) {
  for (const p of [0.005, 0.01, 0.02, 0.03, 0.05, 0.06, 0.08, 0.10, 0.12]) {
    if (p < target - 0.005) PLANS.push({ p, target });
  }
}

// Adds up every possible mistake count, with no shortcuts, so it shares no
// logic with stats.js's own chanceOfShowing() beyond the Wilson range itself.
// (Not cached: the plan checks visit thousands of sizes.)
function successChance(n, p, target) {
  const c = chances(n, p);
  let s = 0;
  for (let k = 0; k <= n; k++) if (wilson(k, n).high < target) s += c[k];
  return s;
}

// The break-even count (recordsNeeded): what the first version of step 2 showed.
function breakEvenTable() {
  return PLANS.map(({ p, target }) => {
    const n = recordsNeeded(p, target);
    return { p, target, n, success: n <= MAX_N ? successChance(n, p, target) : null };
  });
}

// The plan step 2 shows now (planTest). Its promise: testing n OR MORE
// records gives at least the chosen chance. Checked here with this file's
// own exact arithmetic, at every size from n to four times n.
function planTable(chance) {
  return PLANS.map(({ p, target }) => {
    const plan = planTest(p, target, chance);
    if (!plan.exact || plan.n * 4 > MAX_N) return { p, target, n: plan.n, at_n: null, worst_after: null };
    let worst = 1, worstAt = plan.n;
    for (let n = plan.n; n <= plan.n * 4; n++) {
      const s = successChance(n, p, target);
      if (s < worst) { worst = s; worstAt = n; }
    }
    const shortBefore = successChance(plan.n - 1, p, target);
    return { p, target, n: plan.n, at_n: successChance(plan.n, p, target), worst_after: worst, worst_at: worstAt, one_fewer: shortBefore };
  });
}

// Step 3's "examples per version" suggestion: exact chance it delivers the
// right verdict, if the real rates are the ones planned for.
function perVersionTable() {
  const rows = [];
  for (const [pb, pa] of [[0.24, 0.08], [0.27, 0.072], [0.20, 0.10], [0.10, 0.05], [0.06, 0.03], [0.05, 0.10], [0.30, 0.20], [0.15, 0.12]]) {
    const n = perVersionForChange(pb, pa);
    if (n > 1500) { rows.push({ pb, pa, n, right: null }); continue; }
    const v = verdictChances(n, pb, n, pa);
    rows.push({ pb, pa, n, right: pa < pb ? v.better : v.worse, backwards: pa < pb ? v.worse : v.better });
  }
  return rows;
}

// ---- 3. How often does "Real improvement" or "It got worse" mislead? ----
//
// When nothing really changed, any confident verdict is wrong. Each one
// should come up about 2.5% of the time (5% together). When something did
// change, a verdict pointing the wrong way is the worst mistake of all.

function verdictChances(nb, pb, na, pa) {
  const cb = chances(nb, pb), ca = chances(na, pa);
  let better = 0, worse = 0;
  for (let kb = 0; kb <= nb; kb++) {
    if (cb[kb] < 1e-15) continue;
    for (let ka = 0; ka <= na; ka++) {
      const w = cb[kb] * ca[ka];
      if (w < 1e-18) continue;
      const v = compare({ wrong: kb, tested: nb }, { wrong: ka, tested: na }).verdict;
      if (v === 'better') better += w;
      else if (v === 'worse') worse += w;
    }
  }
  return { better, worse, unclear: 1 - better - worse };
}

function noChangeTable() {
  const rows = [];
  for (const [nb, na] of [[20, 20], [50, 50], [100, 100], [200, 200], [500, 500], [50, 200]]) {
    for (const p of [0.01, 0.02, 0.05, 0.10, 0.20, 0.30]) {
      rows.push({ nb, na, p, ...verdictChances(nb, p, na, p) });
    }
  }
  return rows;
}

function realChangeTable() {
  const rows = [];
  for (const [nb, na] of [[50, 50], [100, 100], [200, 200], [500, 500]]) {
    for (const [pb, pa] of [[0.24, 0.08], [0.10, 0.05], [0.27, 0.072], [0.06, 0.03]]) {
      rows.push({ nb, na, pb, pa, ...verdictChances(nb, pb, na, pa) });
    }
  }
  return rows;
}

// ---- 4. Same examples both times (paired mode) ----
//
// Each example lands in one of four boxes: wrong both times, fixed (wrong
// before, right after), broke (right before, wrong after), right both
// times. With the real chance of each box set, the chance of every possible
// (fixed, broke) count is known exactly (the multinomial distribution), so
// the paired verdicts can be added up exactly too.

function lnMulti(n, counts, probs) {
  let s = LOG_FACT[n];
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] === 0) { s -= 0; continue; }
    if (probs[i] === 0) return -Infinity;
    s += counts[i] * Math.log(probs[i]) - LOG_FACT[counts[i]];
  }
  return s;
}

// The shipped pairedDifference() for every (fixed, broke) that fits in n.
const pairedCache = new Map();
function pairedRanges(n) {
  if (!pairedCache.has(n)) {
    const t = [];
    for (let f = 0; f <= n; f++) {
      t.push([]);
      for (let b = 0; f + b <= n; b++) t[f].push(pairedDifference(f, b, n));
    }
    pairedCache.set(n, t);
  }
  return pairedCache.get(n);
}

// Add up a question over every (fixed, broke) outcome, weighted by its chance.
function overPaired(n, pf, pb, question) {
  const t = pairedRanges(n), rest = 1 - pf - pb;
  let total = 0;
  for (let f = 0; f <= n; f++) {
    for (let b = 0; f + b <= n; b++) {
      const lw = lnMulti(n, [f, b, n - f - b], [pf, pb, rest]);
      if (lw < -42) continue; // below 1e-18
      if (question(t[f][b])) total += Math.exp(lw);
    }
  }
  return total;
}

const better = (r) => r.low > 0, worse = (r) => r.high < 0;

function pairedNoChangeTable() {
  const rows = [];
  for (const n of [20, 50, 100, 200, 500]) {
    for (const changed of [0.02, 0.05, 0.10, 0.20, 0.40]) {
      const half = changed / 2;
      rows.push({ n, changed, better: overPaired(n, half, half, better), worse: overPaired(n, half, half, worse) });
    }
  }
  return rows;
}

// Does the paired range contain the real drop (fixed rate - broke rate)?
// "Too high" here means the range sits above the real drop: it overstates
// the improvement, the risky side for a before/after verdict.
function pairedRangeTable() {
  const grid = [0.01, 0.02, 0.05, 0.10, 0.20, 0.30];
  return [20, 50, 100, 200].map((n) => {
    const rows = [];
    for (const pf of grid) for (const pb of grid) {
      const real = pf - pb;
      const tooHigh = overPaired(n, pf, pb, (r) => r.low > real);
      const tooLow = overPaired(n, pf, pb, (r) => r.high < real);
      rows.push({ pf, pb, contains: 1 - tooHigh - tooLow, tooHigh, tooLow });
    }
    const avg = rows.reduce((s, r) => s + r.contains, 0) / rows.length;
    const worst = rows.reduce((a, b) => (b.contains < a.contains ? b : a));
    const riskiest = rows.reduce((a, b) => (b.tooHigh > a.tooHigh ? b : a));
    return { n, cases: rows.length, average_contains: avg, worst_contains: worst.contains, worst_pf: worst.pf, worst_pb: worst.pb,
      worst_overstates: riskiest.tooHigh, overstates_pf: riskiest.pf, overstates_pb: riskiest.pb };
  });
}

// Same paired data, two checks: the matched one, and treating the two runs
// as separate tests (compare()). The separate check sees only the totals
// (wrong both + fixed, wrong both + broke), so the four boxes are needed.
const compareCache = new Map();
function compareTable(n) {
  if (!compareCache.has(n)) {
    const t = [];
    for (let kb = 0; kb <= n; kb++) {
      t.push(new Array(n + 1));
      for (let ka = 0; ka <= n; ka++) t[kb][ka] = compare({ wrong: kb, tested: n }, { wrong: ka, tested: n }).verdict;
    }
    compareCache.set(n, t);
  }
  return compareCache.get(n);
}

function matchedVsSeparate(n, both, pf, pb) {
  const c = compareTable(n), t = pairedRanges(n), right = 1 - both - pf - pb;
  const want = pf > pb ? 'better' : pf < pb ? 'worse' : null;
  let matched = 0, separate = 0, matchedFalse = 0, separateFalse = 0;
  for (let a = 0; a <= n; a++) {
    for (let f = 0; a + f <= n; f++) {
      for (let b = 0; a + f + b <= n; b++) {
        const lw = lnMulti(n, [a, f, b, n - a - f - b], [both, pf, pb, right]);
        if (lw < -42) continue;
        const w = Math.exp(lw), r = t[f][b];
        const mv = r.low > 0 ? 'better' : r.high < 0 ? 'worse' : 'unclear';
        const sv = c[a + f][a + b];
        if (want) { if (mv === want) matched += w; if (sv === want) separate += w; }
        else { if (mv !== 'unclear') matchedFalse += w; if (sv !== 'unclear') separateFalse += w; }
      }
    }
  }
  return want ? { matched, separate } : { matched_false: matchedFalse, separate_false: separateFalse };
}

const SCENARIOS = [
  { name: 'typical fix: most examples unchanged', both: 0.10, pf: 0.10, pb: 0.02 },
  { name: 'big fix', both: 0.06, pf: 0.18, pb: 0.02 },
  { name: 'small fix, little churn', both: 0.08, pf: 0.04, pb: 0.01 },
  { name: 'outcomes unrelated between versions', both: 0.024, pf: 0.176, pb: 0.096 },
  { name: 'nothing changed, some churn', both: 0.08, pf: 0.02, pb: 0.02 },
  { name: 'nothing changed, heavy churn', both: 0.05, pf: 0.10, pb: 0.10 },
];

function matchedVsSeparateTable() {
  const rows = [];
  for (const s of SCENARIOS) for (const n of [50, 100, 200]) rows.push({ ...s, n, ...matchedVsSeparate(n, s.both, s.pf, s.pb) });
  return rows;
}

// Paired-mode "to find out, test about N" suggestion: exact chance it
// delivers the right verdict, if the change keeps fixing and breaking at
// the planned rates.
function pairedPlanTable() {
  return [[0.12, 0.02], [0.10, 0.02], [0.18, 0.02], [0.06, 0.01], [0.15, 0.05], [0.04, 0.01], [0.05, 0.10], [0.20, 0.10]].map(([pf, pb]) => {
    const n = pairedForChange(pf, pb);
    if (n > 1000) return { pf, pb, n, right: null };
    const want = pf > pb ? better : worse;
    return { pf, pb, n, right: overPaired(n, pf, pb, want) };
  });
}

// ---- output ----

const pc = (x, d = 1) => (x * 100).toFixed(d) + '%';

function main() {
  const results = {
    range: rangeTable(),
    break_even: breakEvenTable(),
    plan_80: planTable(0.8),
    plan_90: planTable(0.9),
    plan_95: planTable(0.95),
    no_change: noChangeTable(),
    real_change: realChangeTable(),
    per_version: perVersionTable(),
    paired_no_change: pairedNoChangeTable(),
    paired_range: pairedRangeTable(),
    matched_vs_separate: matchedVsSeparateTable(),
    paired_plan: pairedPlanTable(),
  };
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 1));
    return;
  }

  console.log('## 1. How often does the likely range contain the real rate?\n');
  console.log('Real rates from 0.1% to 50%. Promise: about 95%, with about 2.5% of misses on each side.\n');
  console.log('| Examples | Average | Worst (real rate) | of which "too high" | Rates under 93% | Riskiest "too low", all rates (real rate) | Riskiest "too low", 1-30% (real rate) | Rates with "too low" over 5% |');
  console.log('|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of results.range) {
    console.log(`| ${r.n} | ${pc(r.average_contains)} | ${pc(r.worst_contains)} (${pc(r.worst_at)}) | ${pc(r.worst_too_high)} | ${pc(r.share_below_93, 0)} | ${pc(r.worst_too_low)} (${pc(r.worst_too_low_at)}) | ${pc(r.worst_too_low_typical)} (${pc(r.worst_too_low_typical_at)}) | ${pc(r.share_too_low_over_5, 0)} |`);
  }

  console.log('\n## 2a. The first version of step 2: does "test this many examples" deliver?\n');
  console.log('The real rate equals the rate seen so far. Chance the whole range lands under the target after testing the break-even number.\n');
  console.log('| Real rate | Target | Suggested examples | Chance it works |');
  console.log('|---:|---:|---:|---:|');
  for (const r of results.break_even) {
    console.log(`| ${pc(r.p)} | ${pc(r.target, 0)} | ${r.n} | ${r.success === null ? 'n/a' : pc(r.success)} |`);
  }
  const be = results.break_even.filter((r) => r.success !== null).map((r) => r.success);
  console.log(`\nRange: ${pc(Math.min(...be))} to ${pc(Math.max(...be))}, average ${pc(be.reduce((a, b) => a + b, 0) / be.length)}.`);

  for (const [label, rows, chance] of [['80%', results.plan_80, 0.8], ['90%', results.plan_90, 0.9], ['95%', results.plan_95, 0.95]]) {
    console.log(`\n## 2b. The plan step 2 shows now, at ${label}: does testing that many OR MORE deliver?\n`);
    console.log('| Real rate | Target | Plan | Chance at plan | Worst chance, plan to 4x plan (at) | Chance with one fewer |');
    console.log('|---:|---:|---:|---:|---:|---:|');
    for (const r of rows) {
      if (r.at_n === null) { console.log(`| ${pc(r.p)} | ${pc(r.target, 0)} | ${r.n} | (formula only) | | |`); continue; }
      console.log(`| ${pc(r.p)} | ${pc(r.target, 0)} | ${r.n} | ${pc(r.at_n, 2)} | ${pc(r.worst_after, 2)} (${r.worst_at}) | ${pc(r.one_fewer, 2)} |`);
    }
    const checked = rows.filter((r) => r.at_n !== null);
    const broken = checked.filter((r) => r.worst_after < chance);
    console.log(`\n${checked.length} plans checked exactly; ${broken.length} fall below ${label} anywhere from the plan to 4x the plan.`);
  }

  console.log('\n## 3a. Nothing changed: how often is a confident verdict given anyway?\n');
  console.log('| Before / after examples | Real rate (both) | Says "Real improvement" | Says "It got worse" | Either |');
  console.log('|---|---:|---:|---:|---:|');
  for (const r of results.no_change) {
    console.log(`| ${r.nb} / ${r.na} | ${pc(r.p)} | ${pc(r.better, 2)} | ${pc(r.worse, 2)} | ${pc(r.better + r.worse, 2)} |`);
  }

  console.log('\n## 3b. A real improvement: how often is it spotted, and how often called backwards?\n');
  console.log('| Examples each | Real rates | "Real improvement" | "Can\'t tell yet" | "It got worse" (backwards) |');
  console.log('|---:|---|---:|---:|---:|');
  for (const r of results.real_change) {
    console.log(`| ${r.nb} | ${pc(r.pb)} → ${pc(r.pa)} | ${pc(r.better)} | ${pc(r.unclear)} | ${pc(r.worse, 4)} |`);
  }

  console.log('\n## 3c. Step 3\'s "examples per version" suggestion: exact chance of the right verdict\n');
  console.log('Planned for an 80% chance, if the real rates are the ones planned for.\n');
  console.log('| Real rates | Suggested per version | Right verdict | Backwards verdict |');
  console.log('|---|---:|---:|---:|');
  for (const r of results.per_version) {
    console.log(`| ${pc(r.pb)} → ${pc(r.pa)} | ${r.n} | ${r.right === null ? '(too big to check)' : pc(r.right)} | ${r.right === null ? '' : pc(r.backwards, 4)} |`);
  }

  console.log('\n## 4a. Same examples both times, nothing changed: how often is a confident verdict given anyway?\n');
  console.log('"Changed" is the share of examples that flipped either way (half fixed, half broke).\n');
  console.log('| Examples | Changed | Says "Real improvement" | Says "It got worse" |');
  console.log('|---:|---:|---:|---:|');
  for (const r of results.paired_no_change) {
    console.log(`| ${r.n} | ${pc(r.changed, 0)} | ${pc(r.better, 2)} | ${pc(r.worse, 2)} |`);
  }

  console.log('\n## 4b. Same examples both times: does the range contain the real drop?\n');
  console.log('36 combinations of fixed and broke rates (1% to 30% each). "Overstates" = the range sits above the real drop (the risky side).\n');
  console.log('| Examples | Average | Worst (fixed / broke) | Worst "overstates" miss (fixed / broke) |');
  console.log('|---:|---:|---:|---:|');
  for (const r of results.paired_range) {
    console.log(`| ${r.n} | ${pc(r.average_contains)} | ${pc(r.worst_contains)} (${pc(r.worst_pf, 0)} / ${pc(r.worst_pb, 0)}) | ${pc(r.worst_overstates)} (${pc(r.overstates_pf, 0)} / ${pc(r.overstates_pb, 0)}) |`);
  }

  console.log('\n## 4c. Same paired data, two checks: matched vs. treated as separate tests\n');
  console.log('| Scenario | Before → after | Examples | Matched check | Separate-tests check |');
  console.log('|---|---|---:|---:|---:|');
  for (const r of results.matched_vs_separate) {
    const ba = `${pc(r.both + r.pf)} → ${pc(r.both + r.pb)}`;
    if ('matched' in r) console.log(`| ${r.name} | ${ba} | ${r.n} | ${pc(r.matched)} spotted | ${pc(r.separate)} spotted |`);
    else console.log(`| ${r.name} | ${ba} | ${r.n} | ${pc(r.matched_false, 2)} false alarm | ${pc(r.separate_false, 2)} false alarm |`);
  }

  console.log('\n## 4d. Same examples both times: the "test about N examples" suggestion\n');
  console.log('Planned for an 80% chance, if the change keeps fixing and breaking at these rates.\n');
  console.log('| Fixed / broke | Suggested examples | Right verdict |');
  console.log('|---|---:|---:|');
  for (const r of results.paired_plan) {
    console.log(`| ${pc(r.pf)} / ${pc(r.pb)} | ${r.n} | ${r.right === null ? '(too big to check)' : pc(r.right)} |`);
  }
}

if (require.main === module) main();
module.exports = { chances, rangeAccuracy, successChance, verdictChances };
