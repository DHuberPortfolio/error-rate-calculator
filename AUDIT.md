# How often is this calculator wrong?

A calculator about error rates should know its own error rate. This is the audit: three independent checks, what they found, and what changed because of them.

**In short**

| Check | Question | Result |
|---|---|---|
| 1. Reference library | Are the formulas typed in correctly? | Identical to statsmodels on all 65,808 inputs (to 0.0000000000000003). Same-examples verdicts agree with its McNemar test on all 6,955 inputs tried |
| 2. Exact accuracy | Do the formulas keep their promises? | Ranges: yes, on average. **Sample sizes: no. Step 2 was rebuilt.** Verdicts: yes, with one weak spot. Same-examples mode: as designed, and it spots far more real changes |
| 3. Eval harness | Graded like an AI workflow, how often is a confident verdict wrong? | Separate tests: false "it changed" 17 of 701 (2.4%), backwards 2 of 699 (0.3%). Same examples: false "it changed" 17 of 496 (3.4%), backwards 0 of 704 |

Plus 33 unit tests, which catch all 16 deliberately planted bugs.

---

## Check 1: the same answers as an established library

**Question:** does `stats.js` compute what Wilson's and Newcombe's methods say it should?

**Method:** [`audit/reference_check.py`](audit/reference_check.py) runs the shipped `stats.js` over 65,808 inputs and compares every answer with [statsmodels](https://www.statsmodels.org/), a widely used Python statistics library written independently of this project. The inputs are every possible count for every sample size from 1 to 300, plus large samples up to a million, plus 20,036 before/after pairs.

**Result:**

| | Inputs | Largest difference | Shown number differs |
|---|---:|---:|---:|
| Likely range (Wilson) | 45,772 | 3.3 × 10⁻¹⁶ | 0 |
| Before vs. after (Newcombe) | 20,036 | 3.1 × 10⁻¹⁶ | 0 |

A difference of 10⁻¹⁶ is the limit of computer arithmetic: the formulas are the same.

**One deliberate difference:** "95%" means z = 1.959964 to statsmodels and the conventional 1.96 to this calculator (and to workflow-eval-harness, so the two tools agree). The first run of this check flagged that as a failure, because I'd set the allowance tighter than the z difference moves the numbers. The fixed check compares at the same z (the proof above) and reports the effect of the two conventions separately: at most 0.0013 percentage points, enough to change the shown one-decimal number by 0.1 in 0.23% of single ranges and 0.44% of comparisons.

**Same examples both times** uses Tango's score interval (1998), which statsmodels doesn't have, so it's checked two other ways on 6,955 inputs (every fixed/broke count for every size up to 30, plus 1,500 random cases up to 1,000 examples):

| Check | Result |
|---|---|
| Verdict vs statsmodels' McNemar test, the standard before/after test on the same items | 0 of 6,955 disagree |
| Range vs a second implementation written in Python, which finds the formula's hardest step (the most likely "broke" rate under each candidate drop) by numerical search instead of stats.js's quadratic formula | Largest difference 8 × 10⁻¹⁵ |
| Range vs the published worked example (Fagerland, Lydersen & Laake 2014, as printed by the R package ratesci): fixed 1, broke 7, of 21 | −0.5172 to −0.0260, matching to every printed digit (a unit test) |

Why the verdict should match McNemar exactly: Tango's range is the set of drops a score test can't rule out, and at "no change" that score test *is* McNemar's, (fixed − broke) / √(fixed + broke). So the range excludes zero exactly when McNemar's statistic passes 1.96.

## Check 2: are the promises true?

Matching a library proves the formulas are typed in correctly. It doesn't prove the formulas keep their promises. [`audit/accuracy.js`](audit/accuracy.js) tests the promises themselves.

**Method:** pick a real error rate, say 6%, and a test size, say 50. The chance of seeing each possible number of mistakes (0, 1, 2 … 50) is known exactly; it's the binomial distribution. So "how often is the calculator right when the real rate is 6%?" can be **added up exactly** over every possible test result, with no simulation and no random noise. The script does this for thousands of real rates and sizes, always calling the shipped `stats.js`. Full output: [`audit/results.md`](audit/results.md).

### 2.1 Does the likely range contain the real rate 95% of the time?

A miss can happen two ways, and for an error rate they're not equally bad:

- **too high:** the whole range sits above the real rate. It overstates the mistakes. Annoying, but the safe side.
- **too low:** the whole range sits below the real rate. It understates the mistakes, the way a silent error does. The risky side.

A 95% range should miss about 2.5% of the time on each side. Real rates from 0.1% to 50%:

| Examples | Average | Worst (at real rate) | Worst's misses that are "too high" | Riskiest "too low", 0.1–50% | Riskiest "too low", 1–30% |
|---:|---:|---:|---:|---:|---:|
| 10 | 95.4% | 84.2% (1.7%) | 15.8% | 4.3% | 3.8% |
| 20 | 95.3% | 85.2% (0.8%) | 14.8% | 3.9% | 3.2% |
| 30 | 95.3% | 86.0% (0.5%) | 14.0% | 3.6% | 3.3% |
| 50 | 95.2% | 86.1% (0.3%) | 13.9% | 3.3% | 3.0% |
| 100 | 95.1% | 90.5% (0.1%) | 9.5% | 3.1% | 2.9% |
| 200 | 95.1% | 92.0% (0.5%) | 8.0% | 2.9% | 2.7% |
| 500 | 95.0% | 91.0% (0.1%) | 9.0% | 2.7% | 2.7% |
| 1,000 | 95.0% | 92.0% (0.1%) | 8.0% | 2.7% | 2.6% |

**Finding: the promise holds on average.** The worst cases are at very low real rates, and every one of those misses is on the safe side. A hand check of the 20-example row: the range for "1 mistake in 20" starts at 0.89%, so at a real rate of 0.8% any test that catches a mistake overstates it, and the chance of catching none is 0.992²⁰ = 85.2%, exactly the table's worst case. Risky-side misses run slightly above the ideal 2.5% at small sizes, peaking at 4.3%.

**Limit:** error rates above 50% mirror this table (a 99.2% error rate is a 0.8% success rate), so there the big misses move to the risky side. AI error rates are rarely that high, but the page says "up to 50%" for this reason.

### 2.2 Does "test this many examples" deliver? (The finding that changed the page)

The first version of step 2 said: if mistakes keep turning up at your current rate, here's the smallest test where the whole range lands under your target. For 6% against a 10% target, that's 217.

So I set the real rate to exactly 6%, ran a fresh test of 217, and added up how often the range really lands under 10%: **57.1%.** Across 29 scenarios, the first version's numbers worked **42.0% to 91.8% of the time, 61.9% on average.** A fresh test's rate wobbles around the real one, so planning for the exact break-even point is roughly a coin flip. Nobody reading "test about 217" expects a coin flip.

**The fix:** step 2 now works out the exact chance of success at each test size and suggests the smallest size that reaches your chosen chance (80%, 90% or 95%) **at that size and every size above it.** "And above" matters because whole-number mistake counts make the chance zigzag. For 6% against 10%, 362 examples is the first size to reach 80% (80.15%), but 363 drops to 79.8% and 373 to 75.7%, before 374 jumps back to 81.4%. A plan of "362" would fail anyone who tested a few more. The plan is **398 examples (83.6% chance)**, the first size after which the chance never drops below 80%. The page explains why not 217.

**Checked:** for every scenario, at every size from the plan to four times the plan, using this script's own arithmetic (which shares nothing with `stats.js` beyond the Wilson range):

| Chance chosen | Plans checked | Plans that dip below it anywhere up to 4× | Lowest chance seen |
|---|---:|---:|---:|
| 80% | 29 | 0 | 80.1% |
| 90% | 29 | 0 | 90.0% |
| 95% | 29 | 0 | 95.0% |

One example fewer than the plan always falls short, so the plans aren't padded. When the textbook estimate is above 5,000 examples, the page uses the formula alone (the exact search would be too slow per keystroke) and labels the answer as an estimate.

### 2.3 How often does a before/after verdict mislead?

**Nothing changed** (real rates equal), so any confident verdict is wrong. Each direction should come up about 2.5% of the time:

| Test sizes | False "Real improvement", worst | False "It got worse", worst |
|---|---:|---:|
| Equal, 20 to 500 each | 2.65% | 2.65% |
| Unequal, 50 before / 200 after | **3.31%** | 2.26% |

**Finding:** as designed for equal sizes. **The weak spot is very unequal sizes,** where false improvement calls rise to 3.3%. That's a known trait of Newcombe's method with lopsided small samples. The page notes it in the accuracy section.

**Something did change:** backwards verdicts (calling an improvement "worse") never passed 0.1% in any tested case. But small tests often can't see a real change. A drop from 10% to 5% tested on 50 examples each is spotted only 11.1% of the time:

| Examples each | 24% → 8% | 10% → 5% | 6% → 3% |
|---:|---:|---:|---:|
| 50 | 58.9% | 11.1% | 5.0% |
| 100 | 88.9% | 23.8% | 13.7% |
| 200 | 99.4% | 47.1% | 29.1% |
| 500 | 100.0% | 85.8% | 63.0% |

**Added because of this:** when step 3 says "Can't tell yet", it now suggests how many examples per version would give an 80% chance of a clear answer (the textbook formula for comparing two rates, Fleiss). Checked exactly, it delivers what it says:

| Real rates | Suggested per version | Exact chance of the right verdict |
|---|---:|---:|
| 24% → 8% | 82 | 81.4% |
| 27% → 7.2% | 56 | 81.2% |
| 20% → 10% | 199 | 80.4% |
| 10% → 5% | 435 | 80.3% |
| 6% → 3% | 749 | 80.4% |
| 5% → 10% | 435 | 80.3% |
| 30% → 20% | 294 | 80.3% |

### 2.4 Same examples both times

Teams usually re-run the *same* answer key on the old and new version. Then every example lands in one of four boxes: wrong both times, **fixed** (wrong before, right after), **broke** (right before, wrong after), right both times. The examples that came out the same say nothing about the change; only fixed and broke do. With the real chance of each box set, the chance of every possible (fixed, broke) count is known exactly (the multinomial distribution), so the matched check can be added up exactly too.

**Nothing changed** (as many fixes as breaks, on average): false confident verdicts peak at **2.65% per direction** (500 examples, 5% of them changing), about the designed 2.5%. Full grid of 25 cases in [`results.md`](audit/results.md).

**Does the range contain the real drop?** 36 combinations of fixed and broke rates (1–30% each). For a before/after drop, the risky side is a range sitting *above* the real drop, because it overstates the improvement:

| Examples | Average | Worst (fixed / broke) | Worst "overstates the drop" (fixed / broke) |
|---:|---:|---:|---:|
| 20 | 97.5% | 94.7% (10% / 30%) | 2.8% (30% / 20%) |
| 50 | 95.8% | 93.7% (1% / 20%) | 4.1% (20% / 1%) |
| 100 | 95.0% | 93.3% (1% / 5%) | **5.0%** (5% / 1%) |
| 200 | 95.0% | 94.0% (1% / 2%) | 3.6% (2% / 1%) |

**Finding:** the average holds. The weak spot is when few examples change and nearly all changes go one way: the range then overstates the size of a real improvement up to 5.0% of the time (ideal 2.5%). The verdict's *direction* is unaffected (the no-change check above covers false improvement claims); it's the size of the drop that can read high. This is a known trait of score intervals with lopsided small counts.

**The point of the feature: same paired data, two checks.** The separate-tests check (`compare()`, all step 3 had before) sees only the two totals; the matched check sees which examples changed:

| Scenario | Before → after | Examples | Matched check | Separate-tests check |
|---|---|---:|---:|---:|
| Typical fix: most examples unchanged | 20% → 12% | 50 | **37.4%** spotted | 8.1% spotted |
| | | 100 | **66.1%** | 25.5% |
| | | 200 | **94.1%** | 63.1% |
| Big fix | 24% → 8% | 50 | **78.0%** | 60.5% |
| Small fix, little churn | 12% → 9% | 200 | **47.1%** | 2.8% |
| Outcomes unrelated between versions | 20% → 12% | 100 | 34.5% | 33.8% |
| Nothing changed, some churn | 10% → 10% | 100 | 4.18% false alarm | 0.01% false alarm |
| Nothing changed, heavy churn | 15% → 15% | 100 | 5.22% false alarm | 2.71% false alarm |

When a fix leaves most examples as they were (the usual case), matching spots a real change several times more often. When the two versions' results are unrelated, the two checks tie, so matching costs nothing. The separate check's near-zero false alarms on paired data aren't a virtue: it ignores that the same examples were used, so it's far more cautious than its 2.5%-per-direction design, which is exactly why it misses so much. The matched check's false alarms (about 2.1–2.6% per direction here) are at its design rate.

**"To find out, test about N examples"** in same-examples mode uses the textbook formula for McNemar's test (Connor 1987). Checked exactly, planned for 80%:

| Fixed / broke | Suggested examples | Exact chance of the right verdict |
|---|---:|---:|
| 12% / 2% | 108 | 84.0% |
| 10% / 2% | 145 | 83.8% |
| 18% / 2% | 59 | 84.9% |
| 6% / 1% | 218 | 84.2% |
| 15% / 5% | 155 | 82.5% |
| 4% / 1% | 434 | 83.9% |
| 5% / 10% | 469 | 81.0% |
| 20% / 10% | 234 | 81.0% |

## Check 3: graded by my eval harness

[workflow-eval-harness](https://github.com/DHuberPortfolio/workflow-eval-harness) grades AI workflows against answer keys. Here it grades the calculator, which shows the harness is tool-agnostic: the "workflow" is a JavaScript function.

**Setup** ([`audit/harness/`](audit/harness/)): 1,400 scenarios in 7 traps, 200 each. In every scenario I set the real before and after rates, so the right answer is known, then simulated testing both versions and recorded the shipped `compare()` verdict.

| Harness idea | Here |
|---|---|
| Answer key | What really happened: better, worse, or nothing changed |
| Went out without review | A confident verdict ("Real improvement" / "It got worse") |
| Sent to a person | "Can't tell yet" |
| Silent error | A confident verdict that's wrong |

**Result** ([full report](audit/harness/report.html)):

| Trap | What it tests | Confident and wrong | Real change spotted |
|---|---|---:|---:|
| no-change | equal sizes, 1–30% | 5 of 200, 2.5% (1.1–5.7%) | n/a |
| no-change-near-zero | 0.5–2% error rates | 3 of 200, 1.5% (0.5–4.3%) | n/a |
| no-change-unequal-sizes | 20–50 vs 200–500 | **8 of 200, 4.0% (2.0–7.7%)** | n/a |
| big-improvement | rate falls by two-thirds | 0 | 130 of 200, 65% |
| got-worse | rate doubles | 0 | 126 of 200, 63% |
| small-improvement | rate falls by a fifth | 1 backwards | 37 of 200, 18.5% |
| tiny-samples | 5 or 10 examples | 1 false claim, 1 backwards | n/a |

Across every scenario where nothing changed (the three no-change traps plus the half of tiny-samples with no change), 17 of 701 got a confident verdict: 2.4%, likely 1.5–3.8%. Across every real change, 2 of 699 were called backwards: 0.3%, likely 0.1–1.0%.

The harness's headline silent error rate is 6.0% (19 of 315 confident verdicts, likely 3.9–9.2%). That's the share of confident verdicts that are wrong, and it depends on how many scenarios had no real change, so the rates above are the meaningful ones. They agree with the exact numbers in check 2: about 2.5% false claims with equal sizes, higher with unequal sizes, and backwards calls rare.

### Same examples both times

**Setup** ([`audit/harness/make-paired-run.js`](audit/harness/make-paired-run.js)): 1,200 scenarios in 6 traps, 200 each. Each sets the real before and after rates *and* how much the two versions' mistakes overlap, simulates every example into one of the four boxes, and grades **the same data twice**: the matched check, and the same totals treated as separate tests. Same answer-key format and config as above.

| Trap | What it tests | Matched: confident and wrong | Matched: spotted | Separate: confident and wrong | Separate: spotted |
|---|---|---:|---:|---:|---:|
| paired-no-change | 2–30% error rates, usual overlap | 9 of 200, 4.5% (2.4–8.3%) | n/a | 0 of 200 | n/a |
| paired-no-change-heavy-churn | little overlap | 8 of 200, 4.0% (2.0–7.7%) | n/a | 3 of 200 | n/a |
| paired-big-improvement | rate falls by two-thirds | 0 | **143 of 200** | 0 | 120 of 200 |
| paired-got-worse | rate doubles | 0 | **153 of 200** | 0 | 110 of 200 |
| paired-small-improvement | rate falls by a fifth | 0 | **70 of 200** | 0 | 13 of 200 |
| paired-tiny-samples | 5 or 10 examples | 0 | n/a | 0 | n/a |

Across every no-change scenario (496, including half of tiny-samples), the matched check gave a confident verdict 17 times: 3.4%, likely 2.2–5.4%, inside its design limit of 2.5% per direction (5% both ways). Neither check called any of the 704 real changes backwards (likely 0–0.5%). Reports: [matched](audit/harness/report-paired.html), [separate](audit/harness/report-paired-separate.html).

Read the headline silent error rates with care: matched 4.4% (17 of 389 confident verdicts), separate 1.2% (3 of 248). The separate check looks "safer" only because on paired data it rarely says anything: it spotted 13 of 200 small improvements to the matched check's 70.

## Unit tests, and proof they catch bugs

`npm test` runs 33 tests. Expected numbers were worked out by hand first, confirmed with a separate Python calculation, and include the published worked examples from Newcombe (1998a, Table I; 1998b, Table II) and Fagerland, Lydersen & Laake (2014). One test re-derives the paired formula's hardest step by brute-force search of the likelihood and checks the quadratic shortcut against it at 35 points.

A test suite that never fails proves nothing, so each of these deliberate bugs was planted in a copy of `stats.js`:

| Planted bug | Tests failed |
|---|---:|
| Textbook formula instead of Wilson | 15 of 33 |
| 90% confidence instead of 95% | 20 of 33 |
| One term swapped in the before/after comparison | 4 of 33 |
| Off-by-one in the break-even search | 2 of 33 |
| Sample-size plan one example short | 3 of 33 |
| Plan accepts a lower chance than asked | 3 of 33 |
| Exact chance leaves out the last mistake count | 3 of 33 |
| Per-version formula missing a factor of 2 | 1 of 33 |
| Plan stops at the first size to reach the chance (no "or more") | 3 of 33 |
| Paired: the wrong root of the quadratic | 5 of 33 |
| Paired: variance missing a factor of 2 | 6 of 33 |
| Paired: sign flipped in the quadratic's last term | 3 of 33 |
| Paired: fixed and broke mixed up in the quadratic | 3 of 33 |
| Paired: drop counted backwards | 4 of 33 |
| Paired: after count adds the fixes instead of removing them | 1 of 33 |
| Paired plan ignores the drop in the spread | 1 of 33 |

## Known limits

1. **Plans assume the real rate is what you've seen.** Step 2 and step 3 plan for the rates in your test. If the real rate is worse, you'll need more examples. The page says so in each answer.
2. **Same-examples mode needs the fixed and broke counts.** A side-by-side of the two runs gives both; workflow-eval-harness's `compare` lists the records that stopped being, or became, silent errors. Choosing "separate tests" for paired data is never wrong, only cautious (2.4).
3. **Very unequal test sizes** raise false "Real improvement" calls to about 3.3% (vs 2.5%).
4. **Error rates above 50%** move the larger misses to the risky side (2.1).
5. **Plans above about 5,000 examples** use the textbook formula, not the exact check, and say so.
6. **Step 3's "test about N" suggestions** use textbook formulas (Fleiss for separate tests, Connor for same examples). They were checked exactly for the rate pairs in 2.3 and 2.4 (80.3–84.9%), not for every possible input.
7. **Same examples, lopsided changes:** when few examples change and almost all go one way, the matched range can overstate the size of a real improvement up to 5.0% of the time (ideal 2.5%). The direction of the verdict is unaffected (2.4).

## Reproduce it

```bash
npm test                                         # 33 unit tests
node audit/accuracy.js                           # check 2 (prints audit/results.md's tables)
node audit/harness/make-run.js                   # check 3: regenerate the 1,400 scenarios
node ../workflow-eval-harness/bin/wfeval.js score --config audit/harness/config.json --pred audit/harness/predictions.json --key audit/harness/key.json
node audit/harness/make-paired-run.js            # check 3, same examples: regenerate the 1,200 scenarios
node ../workflow-eval-harness/bin/wfeval.js score --config audit/harness/config.json --pred audit/harness/predictions-paired.json --key audit/harness/key-paired.json
node ../workflow-eval-harness/bin/wfeval.js score --config audit/harness/config.json --pred audit/harness/predictions-paired-separate.json --key audit/harness/key-paired.json
```

Check 1 needs Python 3.11+ with statsmodels:

```bash
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install statsmodels scipy
.venv\Scripts\python audit\reference_check.py
```

Check 3 needs [workflow-eval-harness](https://github.com/DHuberPortfolio/workflow-eval-harness) checked out next to this repo.
