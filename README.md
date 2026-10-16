# How wrong is your AI, really?

A free calculator for anyone who tests an AI workflow on a handful of examples and counts the mistakes. It answers three questions:

1. **What's my real error rate?** 3 mistakes in 50 examples looks like 6%. The real rate is likely anywhere from **2.1% to 16.2%**.
2. **How many examples do I need?** To show that rate is under 10% with an 80% chance of success: **398 in total**. The "obvious" answer, 217, works only 57% of the time. Even a perfect run with zero mistakes needs **73** to show "under 5%".
3. **Did my change actually help?** 24% → 8% on 50 examples each is a **real improvement**, even though the two versions' ranges overlap. Re-ran the same examples on both versions? Say so: 24% → 10% where the change fixed 8 and broke 1 is a real improvement, though treated as separate tests the same totals can't tell. When the answer is "can't tell yet", it says how many examples would tell.

**Try it: https://dhuberportfolio.github.io/error-rate-calculator/**. It runs entirely in your browser, and nothing you type is sent anywhere.

## Why it exists

A common way an AI workflow reaches production: someone tests it on 20 examples, sees no mistakes, and ships it. Zero in 20 is consistent with a real error rate as high as 16%. A count from a small test is a sample, so it isn't the true rate, and the honest way to report it is as a range.

I built this alongside [workflow-eval-harness](https://github.com/DHuberPortfolio/workflow-eval-harness), my tool for grading AI workflows against answer keys. Every rate the harness reports carries this same range, and both tools use the same formula, so they agree to the decimal.

## The math

| Question | Method | Why this one |
|---|---|---|
| Likely range | Wilson score interval, 95% (z = 1.96) | The textbook "p ± 1.96·√(p(1−p)/n)" says 0 mistakes in 7 has a range of exactly 0% to 0%. Wilson stays honest at small counts and at 0%. |
| Did it help? | Newcombe's hybrid score interval (method 10) for the difference of two rates | Builds a range for the difference itself from the two Wilson ranges. The usual shortcut of checking whether the two ranges overlap is too cautious and misses real changes. |
| How many examples | The exact binomial chance of success at each test size; the smallest size that reaches 80%, 90% or 95% there and at every size above it | A new test's rate wobbles, so planning for the break-even point works only about half the time. The chance zigzags with test size, so "and above" is part of the promise. |
| Same examples both times | Tango's score interval for paired data, from the fixed and broke counts | Only the examples that changed carry evidence. Its verdict agrees with McNemar's test, the standard before/after test, and it spots far more real changes than separate-tests math on the same data. |
| "Test about N" (step 3) | The textbook formulas: Fleiss for separate tests, Connor (McNemar) for same examples | Measured exactly: they deliver 80.3–84.9% when 80% is asked for. |

All of it is in [`stats.js`](stats.js), which has no dependencies and runs in both the browser and Node.

## How often is it wrong?

A calculator about error rates should know its own. **[AUDIT.md](AUDIT.md)** has the full audit; in short:

| Check | Result |
|---|---|
| Same answers as [statsmodels](https://www.statsmodels.org/)? | Identical on all 65,808 inputs, at the same z |
| Do 95% ranges contain the real rate 95% of the time? | 95.0–95.4% on average. Worst cases overstate the mistakes (the safe side); misses that understate them peak at 4.3% |
| Does "test this many" deliver? | **The first version didn't: 42–92% of the time.** Rebuilt; now 87 of 87 plans keep their promise at every size up to 4× the plan |
| False "Real improvement" when nothing changed? | About 2.5% as designed; up to 3.3% with very unequal test sizes; at most 2.65% for same-examples tests |
| Same examples: does matching help? | A typical fix (20% → 12%) on 50 re-run examples is spotted 37% of the time, vs 8% treated as separate tests. Verdicts agree with statsmodels' McNemar test on all 6,955 inputs tried |
| Graded by my eval harness, 2,600 scenarios | Separate tests: 17 of 701 no-change scenarios got a confident verdict (2.4%); 2 of 699 real changes called backwards (0.3%). Same examples: 17 of 496 (3.4%); 0 of 704 backwards |

`npm test` runs 33 unit tests. Every expected number was worked out by hand first, confirmed with a separate Python calculation, and includes the published worked examples from Newcombe's 1998 papers and Fagerland, Lydersen & Laake (2014). The suite catches all 16 deliberately planted bugs listed in the audit. GitHub Actions runs it on every push, on Linux and Windows, on Node 18, 22 and 24.

## Files

- [`index.html`](index.html): the page. Plain HTML, CSS and JavaScript, no build step. Open it straight from disk.
- [`stats.js`](stats.js): the math, shared by the page, the tests and the audit.
- [`test/stats.test.js`](test/stats.test.js): the unit tests, using Node's built-in test runner.
- [`AUDIT.md`](AUDIT.md): how often the calculator is wrong, and what changed because of it.
- [`audit/`](audit/): the three checks. `reference_check.py` (statsmodels, McNemar, and a second implementation of the paired method), `accuracy.js` (exact accuracy, output in `results.md`), and `harness/` (graded by workflow-eval-harness: [separate tests](audit/harness/report.html), [same examples, matched](audit/harness/report-paired.html), [same examples, treated as separate](audit/harness/report-paired-separate.html)).

## References

- Wilson, E. B. (1927). Probable inference, the law of succession, and statistical inference. *Journal of the American Statistical Association*, 22(158), 209–212.
- Newcombe, R. G. (1998a). Two-sided confidence intervals for the single proportion: comparison of seven methods. *Statistics in Medicine*, 17(8), 857–872.
- Newcombe, R. G. (1998b). Interval estimation for the difference between independent proportions: comparison of eleven methods. *Statistics in Medicine*, 17(8), 873–890.
- Tango, T. (1998). Equivalence test and confidence interval for the difference in proportions for the paired-sample design. *Statistics in Medicine*, 17(8), 891–908.
- McNemar, Q. (1947). Note on the sampling error of the difference between correlated proportions or percentages. *Psychometrika*, 12(2), 153–157.
- Connor, R. J. (1987). Sample size for testing differences in proportions for the paired-sample design. *Biometrics*, 43(1), 207–211.
- Fagerland, M. W., Lydersen, S., & Laake, P. (2014). Recommended tests and confidence intervals for paired binomial proportions. *Statistics in Medicine*, 33(16), 2850–2875.

## License

MIT. Built by [Devin Huber](https://devinhuber.com/).
