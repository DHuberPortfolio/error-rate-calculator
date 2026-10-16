// Runs the shipped stats.js over a large grid of inputs and prints every
// answer as JSON, so reference_check.py can compare them with statsmodels.
// The grid is fixed (seeded), so every run checks the same cases.

const { wilson, compare, pairedDifference } = require('../stats.js');

// Small seeded random generator (mulberry32), so the "random" cases repeat.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261015);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const single = [];
// Every possible count for every sample size from 1 to 300.
for (let n = 1; n <= 300; n++) for (let k = 0; k <= n; k++) single.push([k, n]);
// Big samples: the edges plus random counts.
for (const n of [500, 1000, 2000, 5000, 10000, 100000, 1000000]) {
  for (const k of [0, 1, 2, 5, n - 1, n]) single.push([k, n]);
  for (let i = 0; i < 40; i++) single.push([int(0, n), n]);
}

const pairs = [];
for (let i = 0; i < 20000; i++) {
  const n1 = int(1, 500), n2 = int(1, 500);
  pairs.push([int(0, n1), n1, int(0, n2), n2]);
}
// Edges: zero and all-wrong on either side, tiny samples, identical results.
for (const n of [1, 2, 5, 20, 50, 500]) {
  for (const [a, b] of [[0, 0], [0, n], [n, 0], [n, n], [1, 0], [0, 1]]) pairs.push([a, n, b, n]);
}

// Same examples both times: every (fixed, broke) for every size up to 30,
// plus random cases up to 1,000 examples.
const paired = [];
for (let n = 1; n <= 30; n++) for (let f = 0; f <= n; f++) for (let b = 0; f + b <= n; b++) paired.push([f, b, n]);
for (let i = 0; i < 1500; i++) {
  const n = int(31, 1000), f = int(0, Math.floor(n / 3)), b = int(0, Math.floor(n / 3));
  paired.push([f, b, n]);
}

console.log(JSON.stringify({
  single: single.map(([k, n]) => { const r = wilson(k, n); return [k, n, r.low, r.high]; }),
  pairs: pairs.map(([k1, n1, k2, n2]) => {
    const c = compare({ wrong: k1, tested: n1 }, { wrong: k2, tested: n2 });
    return [k1, n1, k2, n2, c.low, c.high];
  }),
  paired: paired.map(([f, b, n]) => { const r = pairedDifference(f, b, n); return [f, b, n, r.low, r.high]; }),
}));
