// Check 3: grade the calculator's before/after verdicts with
// workflow-eval-harness, the same way it grades AI workflows.
//
// Each record is one scenario where we set the real error rates before and
// after a change, so the right answer is known. We simulate testing both
// versions (random mistakes at those real rates), hand the counts to the
// shipped compare(), and record its verdict.
//
//   answer key (key.json):        what really happened: better, worse, or
//                                 unclear (nothing changed, so nothing to claim)
//   predictions (predictions.json): the calculator's verdict, and its route:
//                                 CONFIDENT for "Real improvement" / "It got
//                                 worse" (goes out as a claim, like a workflow
//                                 publishing without review), CANT_TELL_YET
//                                 for "Can't tell yet" (handed back to a
//                                 person, like a review queue)
//
// So a silent error is a confident verdict that is wrong: claiming a change
// that didn't happen, or calling it backwards. "Can't tell yet" is never a
// silent error, only a missed chance (an unnecessary review, in harness terms).
//
// Seeded, so every run produces the same files.
// Run from the repo root:  node audit/harness/make-run.js

const fs = require('fs');
const path = require('path');
const { compare } = require('../../stats.js');

function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(424242);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);
// Test n examples at real rate p: count the mistakes.
const mistakes = (n, p) => { let k = 0; for (let i = 0; i < n; i++) if (rand() < p) k++; return k; };

const PER_TRAP = 200;

// Each trap: how to draw the real rates and the sample sizes.
const TRAPS = {
  // Nothing changed: any confident verdict is a false claim.
  'no-change': () => {
    const p = between(0.01, 0.30), n = pick([20, 50, 100, 200, 500]);
    return { pb: p, pa: p, nb: n, na: n };
  },
  'no-change-unequal-sizes': () => {
    const p = between(0.01, 0.30), small = pick([20, 50]), big = pick([200, 500]);
    return rand() < 0.5 ? { pb: p, pa: p, nb: small, na: big } : { pb: p, pa: p, nb: big, na: small };
  },
  'no-change-near-zero': () => {
    const p = pick([0.005, 0.01, 0.02]), n = pick([50, 100, 200, 500]);
    return { pb: p, pa: p, nb: n, na: n };
  },
  // Real changes: the right confident answer exists, but small tests may not see it.
  'big-improvement': () => {
    const pb = between(0.15, 0.30), n = pick([20, 50, 100, 200]);
    return { pb, pa: pb / 3, nb: n, na: n };
  },
  'small-improvement': () => {
    const pb = between(0.05, 0.30), n = pick([50, 100, 200, 500]);
    return { pb, pa: pb * 0.8, nb: n, na: n };
  },
  'got-worse': () => {
    const pb = between(0.03, 0.15), n = pick([50, 100, 200, 500]);
    return { pb, pa: pb * 2, nb: n, na: n };
  },
  // Very small tests, changed or not.
  'tiny-samples': () => {
    const pb = between(0.05, 0.40), n = pick([5, 10]);
    return { pb, pa: rand() < 0.5 ? pb : pb / 2, nb: n, na: n };
  },
};

const key = [], predictions = [];
let i = 0;
for (const [trap, draw] of Object.entries(TRAPS)) {
  for (let j = 0; j < PER_TRAP; j++) {
    const id = `S${String(++i).padStart(4, '0')}`;
    const { pb, pa, nb, na } = draw();
    const truth = pa < pb ? 'better' : pa > pb ? 'worse' : 'unclear';
    key.push({
      id, trap, verdict: truth,
      expected_route: truth === 'unclear' ? 'CANT_TELL_YET' : 'CONFIDENT',
      real_rate_before: +pb.toFixed(4), real_rate_after: +pa.toFixed(4),
    });
    const before = { wrong: mistakes(nb, pb), tested: nb };
    const after = { wrong: mistakes(na, pa), tested: na };
    const { verdict } = compare(before, after);
    predictions.push({
      id, verdict,
      route: verdict === 'unclear' ? 'CANT_TELL_YET' : 'CONFIDENT',
      before, after,
    });
  }
}

const dir = __dirname;
fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify(key, null, 1) + '\n');
fs.writeFileSync(path.join(dir, 'predictions.json'), JSON.stringify(predictions, null, 1) + '\n');
console.log(`Wrote ${key.length} scenarios across ${Object.keys(TRAPS).length} traps to ${path.relative(process.cwd(), dir)}`);
