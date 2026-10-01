# Cost estimate: 1k / 10k / 100k requests

> **These are estimates, not measurements.** The live provider was not run during development; token counts come
> from the prompt's size and a typical ticket. Prices change — verify against the provider pricing page before
> relying on them. Model assumed: Claude Haiku 4.5 at **$1 / M input tokens, $5 / M output tokens**.

## Per-request token model

| Part | Tokens (approx.) |
|---|---|
| System prompt (rules + schema) | ~450 |
| Ticket (typical 600–800 chars) | ~200 |
| Refinement + previous result (only on re-ask) | +~300 |
| **Input, first ask** | **~650** |
| Output JSON (summary, fields, entities, confidence) | ~250 |

Cost per first-ask request: `650 × $1/M + 250 × $5/M = $0.00065 + $0.00125 ≈ $0.0019`.
Re-ask: input ≈ 950 → ≈ $0.0022. Add a safety margin of 10% for repair retries (≈ 3–5% of requests).

## LLM cost

| Requests | No cache | With 20% cache hits | With 20% cache + 15% re-asks |
|---|---|---|---|
| 1,000 | ≈ $1.90 | ≈ $1.52 | ≈ $1.65 |
| 10,000 | ≈ $19 | ≈ $15 | ≈ $16.5 |
| 100,000 | ≈ $190 | ≈ $152 | ≈ $165 |

Output tokens are ~65% of cost, so the biggest levers are: shorter `summary`, `max_tokens` cap (already 700), and
caching. A 2× pricier model (e.g. a larger tier for low-confidence cases only) applied to 10% of traffic adds
roughly +10–15%.

## Infrastructure cost (monthly, us-east-1, rough list prices)

| Item | Configuration | ≈ $/month |
|---|---|---|
| Fargate | 2 tasks × 0.5 vCPU / 1 GB, 24×7 | 35 |
| ALB | 1 ALB + low LCU | 20 |
| NAT gateway | 1, + data processing | 35–40 |
| RDS PostgreSQL | db.t4g.micro **Multi-AZ**, 20 GB | 30 |
| CloudWatch logs, ECR, Secrets Manager | small | 5–10 |
| **Fixed baseline** | | **≈ $125–135** |

Scaling to 100k requests/month adds little infrastructure: 100k/month is ~0.04 req/s on average. Even a bursty
50 req/s peak (long-lived calls, ~3 s each ⇒ ~150 concurrent) fits within ~10 small tasks while the burst lasts.
At this scale **the fixed baseline dominates the bill below ~50k requests/month, and the LLM dominates above it**.

## Total

| Requests / month | LLM (with cache + re-asks) | Infra | ≈ Total | Cost per request |
|---|---|---|---|---|
| 1,000 | $2 | $130 | **≈ $132** | $0.13 |
| 10,000 | $17 | $130 | **≈ $147** | $0.015 |
| 100,000 | $165 | $150–200 (more tasks, DB headroom) | **≈ $315–365** | $0.003–0.004 |

Dev/demo option: single-AZ RDS, 1 task and no NAT (public subnets) brings fixed cost to ≈ $40–50/month.

## Cost controls already in the system
Per-user rate limit and daily token budget, result cache, `max_tokens`, input size limit, timeouts, abort on
client disconnect, per-request cost stored in the DB (`cost_usd`) so real spend can replace these estimates after
the first week of traffic.
