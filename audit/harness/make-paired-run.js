// Check 3, paired mode: grade "same examples both times" with
// workflow-eval-harness, on scenarios where the right answer is known.
//
// Each scenario sets the real error rates before and after a change, and how
// much the two versions' mistakes overlap (the same hard examples tend to
// stay wrong, so overlap is usual). Every simulated example lands in one of
// four boxes: wrong both times, fixed, broke, right both times.
//
// The same simulated data is graded twice:
//   predictions-paired.json           the matched check (comparePaired)
//   predictions-paired-separate.json  the same totals treated as separate
//                                     tests (compare), what step 3 did before
//
// Same answer key format and config as make-run.js. Seeded, so every run
// produces the same files.
// Run from the repo root:  node audit/harness/make-paired-run.js

const fs = require('fs');
const path = require('path');
const { compare, comparePaired } = require('../../stats.js');

function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(161016);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);

const PER_TRAP = 200;

// overlap 0: the versions' mistakes are unrelated; 1: as overlapping as the
// rates allow (every mistake the better version makes, the worse one makes too).
const TRAPS = {
  'paired-no-change': () => {
    const p = between(0.02, 0.30);
    return { pb: p, pa: p, n: pick([20, 50, 100, 200, 500]), overlap: between(0.3, 0.9) };
  },
  'paired-no-change-heavy-churn': () => {
    const p = between(0.05, 0.30);
    return { pb: p, pa: p, n: pick([20, 50, 100, 200, 500]), overlap: between(0, 0.3) };
  },
  'paired-big-improvement': () => {
    const pb = between(0.15, 0.30);
    return { pb, pa: pb / 3, n: pick([20, 50, 100, 200]), overlap: between(0.5, 1) };
  },
  'paired-small-improvement': () => {
    const pb = between(0.05, 0.30);
    return { pb, pa: pb * 0.8, n: pick([50, 100, 200, 500]), overlap: between(0.5, 1) };
  },
  'paired-got-worse': () => {
    const pb = between(0.03, 0.15);
    return { pb, pa: pb * 2, n: pick([50, 100, 200, 500]), overlap: between(0.5, 1) };
  },
  'paired-tiny-samples': () => {
    const pb = between(0.05, 0.40);
    return { pb, pa: rand() < 0.5 ? pb : pb / 2, n: pick([5, 10]), overlap: between(0.3, 1) };
  },
};

const key = [], matched = [], separate = [];
let i = 0;
for (const [trap, draw] of Object.entries(TRAPS)) {
  for (let j = 0; j < PER_TRAP; j++) {
    const id = `P${String(++i).padStart(4, '0')}`;
    const { pb, pa, n, overlap } = draw();
    const both = overlap * Math.min(pb, pa) + (1 - overlap) * pb * pa;
    const pf = pb - both, pk = pa - both;
    let a = 0, f = 0, k = 0;
    for (let e = 0; e < n; e++) {
      const u = rand();
      if (u < both) a++;
      else if (u < both + pf) f++;
      else if (u < both + pf + pk) k++;
    }
    const truth = pa < pb ? 'better' : pa > pb ? 'worse' : 'unclear';
    key.push({
      id, trap, verdict: truth,
      expected_route: truth === 'unclear' ? 'CANT_TELL_YET' : 'CONFIDENT',
      real_rate_before: +pb.toFixed(4), real_rate_after: +pa.toFixed(4), overlap: +overlap.toFixed(3),
    });
    const counts = { tested: n, wrong_both: a, fixed: f, broke: k };
    const m = comparePaired({ tested: n, wrongBefore: a + f, fixed: f, broke: k }).verdict;
    const s = compare({ wrong: a + f, tested: n }, { wrong: a + k, tested: n }).verdict;
    matched.push({ id, verdict: m, route: m === 'unclear' ? 'CANT_TELL_YET' : 'CONFIDENT', counts });
    separate.push({ id, verdict: s, route: s === 'unclear' ? 'CANT_TELL_YET' : 'CONFIDENT', counts });
  }
}

const dir = __dirname;
const write = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 1) + '\n');
write('key-paired.json', key);
write('predictions-paired.json', matched);
write('predictions-paired-separate.json', separate);
console.log(`Wrote ${key.length} paired scenarios across ${Object.keys(TRAPS).length} traps to ${path.relative(process.cwd(), dir)}`);
