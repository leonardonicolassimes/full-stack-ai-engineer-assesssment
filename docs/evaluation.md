# AI evaluation and reliability

This is a design, not an implementation: there is no eval harness in the repo. What *is* implemented are the
runtime signals the evaluation would rely on (prompt/model versioning on every row, confidence, `needs_review`,
user feedback, token/latency/cost metrics).

## 1. How I would measure output quality

Extraction has structure, so most of the quality can be measured **without** another LLM.

**Golden set.** 100–300 real, anonymised tickets labelled by humans, stratified by category, language, length,
adversarial cases (injection attempts, empty/very short text, mixed languages, PII-heavy), and known-hard
boundaries (billing vs refund). Version it in the repo; add every production failure to it.

**Per-field metrics**
| Field | Metric |
|---|---|
| category, priority, sentiment | accuracy, macro-F1, confusion matrix (priority off-by-one is less severe than urgent→low: use a weighted/ordinal error) |
| entities | precision / recall / F1 on (type, value), after normalisation |
| summary | LLM-as-judge on faithfulness (no claims absent from the ticket) + brevity; spot-checked by humans to calibrate the judge |
| calibration | do confidence scores mean something? Reliability diagram / ECE; precision of "high-confidence" bucket |
| reliability | schema-valid rate on first attempt, repair rate, failure (502) rate |
| ops | p50/p95 latency, tokens and cost per request |

**Online signals** (already collected): 👍/👎 rate per prompt version, share of results with `needs_review`,
refinement rate (users re-asking is a proxy for "first answer was wrong"), repair-retry rate, injection-signal rate.

## 2. How I would detect regressions after a prompt or model change

1. **Prompts are versioned and every result records `prompt_version` + `model`**, so changes are explicit and diffable.
2. **CI gate:** a PR that touches `ai/prompts/**`, the schema, or the model id runs the golden set (cached
   responses for unchanged inputs to keep cost low) and posts a comparison table against `main`. Fail the check on
   statistically meaningful drops (e.g. category F1 −2 pts, entity recall −3 pts, valid-JSON rate < 99%), with a
   hard fail on any new critical error (e.g. an injection case that now changes the label).
3. **Pairwise judge** for the free-text summary (old vs new, order randomised) to catch style/faithfulness drift
   that metrics miss.
4. **Shadow / canary rollout:** run the new version on a sample of live traffic in shadow (result not shown),
   compare agreement with the current version and cost/latency; then ramp 5% → 25% → 100% by config.
   Rollback = set `PROMPT_VERSION` back (no deploy of code needed).
5. **Provider-side drift:** model aliases can change silently; pin dated model ids (as the default does), run the
   golden set on a daily schedule against production config, and alert on regressions even with no deploy.

## 3. When "the AI gives a wrong answer" in production

**Prevent / contain (already built)**
- Strict schema validation + repair retry; ungrounded entities removed.
- Calibrated uncertainty is shown to the user (`needs_review` with reasons); the UI never presents a low-confidence
  result as fact.
- Humans stay in the loop: the output is a *suggestion* for triage, not an automatic action.

**Detect**
- 👎 feedback and re-ask rate per category/prompt version; alert when they spike.
- Dashboards: `needs_review` share, confidence distribution, repair/failure rate.

**Respond (runbook)**
1. Capture: the extraction id gives `input_text` (masked), result, prompt version, model, tokens — enough to
   reproduce (re-run with the same version; pin temperature low for reproducibility).
2. Classify the failure: bad prompt rule, model limitation, ambiguous ticket, injection, bad masking, schema gap.
3. Mitigate fast: roll back prompt version / model via config; raise the review threshold; for a bad category,
   temporarily route that category to human review.
4. Fix properly: add the case to the golden set **first** (so it fails), then change prompt/logic, verify no
   regressions, ship through the CI gate.
5. Communicate: if downstream decisions were affected, use the audit log (`extraction.create` events by prompt
   version/time window) to identify impacted records and re-process or notify.

**Longer term:** use the 👎-labelled production cases as training/eval data, and consider routing low-confidence
cases to a stronger model before showing them to the user.
