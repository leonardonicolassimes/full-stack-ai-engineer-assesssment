# Support Ticket Extractor — AI-powered full-stack assessment

An AI assistant that turns free-text customer support tickets into **structured, validated, reviewable data**
(category, priority, sentiment, entities, per-field confidence), with streaming status, a refine/re-ask loop and
explicit handling of uncertainty.

| | |
|---|---|
| **Use case chosen** | *Extract structured data from free text* (support tickets) |
| **Backend** | Node.js 22 + TypeScript, Fastify, PostgreSQL, JWT, Zod |
| **AI** | Provider abstraction (Anthropic Claude + deterministic Mock), versioned prompts, schema-validated output, SSE streaming |
| **Frontend** | React 19 + Vite, 4 pages (Login, Analyze, Detail, History) |
| **Infra** | Docker (multi-stage), docker-compose, Terraform for AWS (ECS Fargate + RDS + Secrets Manager) — validated/planned offline, **never applied** |
| **Bonus done** | Streaming responses (SSE) · Cost estimation (1k/10k/100k) |

## Why this scope

I picked **structured extraction** over document Q&A because it is the use case where the interesting
production problems are *measurable*: the output has a schema, fields can be scored against ground truth, and
"the model is unsure" can be expressed as data (confidence) instead of prose. Q&A over documents would have pushed
the time budget into a RAG pipeline (chunking, embeddings, retrieval quality) and left less room for the
engineering concerns the assessment emphasizes (safety, cost, reliability, deployment). RAG is described as a next
step below, deliberately not half-built.

Deliberately **out of scope**: RAG/vector store, file uploads (text only), multi-tenancy beyond per-user isolation,
background queues, tool calling, password reset / email verification.

---

## Run locally

Requirements: Node 20+ (tested on 24), Docker.

```bash
cp .env.example .env            # defaults work as-is; LLM_PROVIDER=mock needs no API key
npm install
docker compose up -d postgres   # Postgres 16
npm run migrate
npm run dev:backend             # http://localhost:3000   (separate terminal)
npm run dev:frontend            # http://localhost:5173   (separate terminal)
```

> **Login: there are no pre-seeded users.** On the login page click **"No account? Register"** and sign up with
> **any email** (e.g. `test@test.com` — nothing is sent or verified) and **any password of 8+ characters**.
> Then analyze one of the "Example" tickets.

**Everything in containers** (API + web via nginx + Postgres):

```bash
docker compose --profile full up --build     # open http://localhost:8080
```

**Use the real LLM** — set in `.env`:

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

**Tests** (need Postgres running): `npm test` — 32 tests: input guard, post-processing, API flows (auth, cache,
refine, SSE, isolation between users, repair retry, failure handling, no provider-error leakage), retention.

> **Honest status:** the Anthropic provider is implemented against the official SDK but was **not exercised against
> the live API in development** (no key was available). All flows and tests run on the Mock provider, which goes
> through the identical pipeline (guard → prompt → provider → post-process → persist).

---

## Architecture

```
React (Vite) ──HTTPS──▶ ALB ──▶ ECS Fargate (Fastify API) ──▶ RDS PostgreSQL
                                    │
                                    └──▶ LLM provider (Anthropic) via NAT
```

Request path for `POST /api/extractions` (and `/stream` for SSE):

```
 auth (JWT) → per-user rate limit
   → InputGuard      normalize · mask PII · detect/defang injection · size limits         (ai/guard.ts)
   → budget check    rolling 24h token budget per user                                     (extractions/service.ts)
   → cache lookup    same input + prompt version + model ⇒ no LLM call                     (extractions/repo.ts)
   → PromptBuilder   versioned template, ticket delimited as DATA                          (ai/prompts/)
   → LLMProvider     Anthropic | Mock; timeout, abort on client disconnect, retries        (ai/providers/)
   → PostProcessor   parse → Zod validate → ground entities → flag low confidence          (ai/postprocess.ts)
        └─ invalid? one repair retry with the concrete validation error, then 502
   → persist         result + prompt_version + model + tokens + cost + latency
   → audit           metadata only, never content
```

The three AI concerns the brief asks to keep separate are separate **modules with no cross-imports**:
prompt construction (`ai/prompts`), model invocation (`ai/providers`), response post-processing
(`ai/postprocess.ts`). `extractions/service.ts` is the only place that sequences them.

### Key decisions

| Decision | Why | Trade-off |
|---|---|---|
| **Fastify + raw SQL (`pg`) + SQL migrations** | Small surface, easy to review; schema is part of the design | No ORM conveniences; migrations are forward-only |
| **PostgreSQL** | Relational (users → extractions → audit) + JSONB for model output; `pgvector` is a drop-in for RAG later | Single writer; fine at this scale |
| **Zod at every boundary** (env, requests, model output) | The LLM is an untrusted input source; schema is the contract | Strict schema means more repair retries on weak models |
| **SSE over WebSockets** | One-way server→client, works through ALB/nginx, trivial to cancel | Needs `fetch`-based client (no `EventSource`, which can't POST/auth) |
| **Mock provider as a first-class citizen** | Deterministic tests, runs offline, zero cost for reviewers | Not a quality baseline for the real model |
| **JWT in `localStorage`** | Simple SPA flow | XSS-readable; production should use httpOnly SameSite cookies + refresh rotation |
| **`bcryptjs`** (pure JS) | No native build step on any OS | Slower than argon2/native bcrypt; argon2id preferred in production |

---

## AI design choices

### Structured output, never trusted
The model must return one JSON object matching a Zod schema (`ai/schema.ts`). `postprocess.ts`:
1. extracts JSON (tolerates code fences / surrounding prose),
2. **validates strictly** — invalid enum, missing field or out-of-range confidence is rejected,
3. **grounds entities** — any extracted entity that does not literally appear in the ticket is *dropped* and
   reported (cheap, deterministic hallucination guard),
4. computes `needs_review` + human-readable `review_reasons` from low confidence (<0.6), model-stated uncertainty,
   or removed entities.

If validation fails, the service makes **one repair attempt** that feeds the concrete validation error back to the
model. Both attempts' tokens are billed to the request record. A second failure becomes a clean 502 and a
`failed` row — never a partial/guessed answer.

### Prompt versioning
Prompts are code (`ai/prompts/v1.ts`) behind a registry, selected by `PROMPT_VERSION`. Every stored result records
`prompt_version` and `model`, so any output is traceable and A/B or rollback is a config change. The cache key
includes both, so a prompt change never serves stale results.

### Provider switching
`LLMProvider` is a 2-method interface (`complete`, `stream`). `LLM_PROVIDER=mock|anthropic` picks the
implementation; adding OpenAI/Bedrock is one file plus a pricing entry.

### How I prevent prompt injection / unsafe input
No single control is sufficient; the design is layered and assumes the model **will** sometimes be fooled:

1. **Structural separation** — instructions live in the system prompt; the ticket is wrapped in `<ticket>` tags and
   declared to be untrusted data. User "refine" text goes in a separate `<refinement>` block that is explicitly
   allowed to change focus only.
2. **Delimiter defanging** — any `<ticket>`, `<system>`, `<refinement>`… tags inside user input are stripped so the
   input cannot close its own block.
3. **Detection (advisory)** — regex signals (`ignore previous instructions`, prompt exfiltration, role override…)
   are surfaced to the user and written to the audit log, but do **not** block: a ticket may legitimately quote such
   text, and regexes are trivially bypassed, so they are telemetry, not a wall.
4. **Constrained output** — the only thing the model can produce is schema-valid JSON from closed enums. A hijacked
   model can at worst mislabel a ticket; it cannot emit instructions, HTML or code that our system executes or renders.
5. **No tools, no secrets in the prompt** — the model cannot call anything, and the API key never enters the context.
6. **Output is never rendered as HTML** — React escapes all values.
7. **Input hygiene** — Unicode NFKC normalization, removal of control / zero-width / bidi characters, 8k char limit,
   256 KB body limit.

*Known gap:* a clever injection can still bias category/priority within the allowed enums. That is why
low-confidence/uncertain results are flagged and why there is a feedback + evaluation loop (see
[docs/evaluation.md](docs/evaluation.md)).

### How I'd control cost and rate limits in production
Implemented now:
- **Per-user rate limit** (20 req/min on AI endpoints, keyed by verified JWT subject, not IP) and stricter limits on
  auth endpoints; global per-IP limit.
- **Per-user rolling 24h token budget** (`DAILY_TOKEN_BUDGET`) → HTTP 429.
- **Result cache** for identical input/prompt/model (no LLM call at all).
- **Hard caps**: input size, `max_tokens` on output, 30s timeout, at most 1 repair retry.
- **Cheapest adequate model by default** (Claude Haiku); cost per request recorded in the DB.
- **Abort on disconnect** — closing the tab cancels the upstream call so we stop paying for tokens nobody reads.

Would add in production: an org-wide spend ceiling with CloudWatch alarms and a kill switch
(`LLM_PROVIDER=mock` or maintenance mode via config), a dedicated token counter (the current budget is computed
from stored rows, so a user who deletes history resets it), model routing (small model first, escalate on low
confidence), provider-side prompt caching once the system prompt is large enough to benefit, and AWS WAF
rate-based rules at the ALB. See [docs/cost-estimate.md](docs/cost-estimate.md).

### AI-aware UX
- **Model status**: `checking → generating → verifying → retrying`, with a cancel button.
- **Partial results**: raw streamed model output is shown live (labelled "not yet validated"); the structured card
  appears only after validation.
- **Uncertainty**: per-field confidence meters, an explicit "AI is not fully certain — verify" callout with reasons,
  entities limited to values found in the text, notices when PII was masked or instruction-like text was ignored.
- **Refine / re-ask**: a linked child extraction with the user's instruction; 👍/👎 feedback on each result.
- **Failure states**: loading, empty, network error, validation error, provider failure, timeout, cancelled.

---

## Data, privacy, evaluation, infrastructure

Short, focused documents (each answers specific questions from the brief):

- [docs/data-and-privacy.md](docs/data-and-privacy.md) — what is stored vs not, retention, PII, logging, auditability
- [docs/evaluation.md](docs/evaluation.md) — quality metrics, regression detection, handling "AI gave a wrong answer"
- [docs/infrastructure.md](docs/infrastructure.md) — AWS design, secrets & rotation, scaling for bursty AI load, AI-specific constraints
- [docs/cost-estimate.md](docs/cost-estimate.md) — cost at 1k / 10k / 100k requests

### Infrastructure at a glance
Terraform in `infra/terraform` defines VPC (public/private subnets), ALB, ECS Fargate service with target-tracking
autoscaling, RDS PostgreSQL (encrypted, Multi-AZ, backups), ECR (immutable tags, scan on push), CloudWatch logs,
and least-privilege IAM. **No secret values exist in code or Terraform state**: RDS generates its own password in
Secrets Manager, and the JWT / LLM keys are secret *containers* whose values are loaded out-of-band.

```bash
cd infra/terraform
terraform init -backend=false
terraform validate
terraform plan -var-file=mock.tfvars      # offline, dummy credentials, no AWS calls, no cost → 39 resources
```

`mock.tfvars` sets `mock_mode = true`, which makes the AWS provider skip credential/account validation. It has been
validated and planned this way only; **`apply` was never run**, so runtime behaviour in AWS (e.g. the exact health-check
timing, RDS TLS verification) is unverified.

---

## Known limitations & trade-offs (honest list)

- Anthropic provider not run against the live API in development (see status note above).
- Token budget is derived from stored extractions (deleting history resets it) — needs a separate counter.
- JWT in `localStorage`, no refresh tokens, no email verification / password reset / account lockout.
- Injection detection is heuristic and English-centric; the structural defenses are the real protection.
- PII masking is regex-based (email, Luhn-valid cards, phone with separators, US-style ID). It will miss names,
  addresses and non-US formats; production should add a dedicated PII service (e.g. Amazon Comprehend / Presidio).
- Output is requested as prompted JSON + validation + repair. Native structured-output / tool-use JSON mode would
  reduce repair retries on the real model.
- Retention purge runs in-process hourly (idempotent, multi-instance safe); a scheduled job would be cleaner.
- DB TLS is enabled but the RDS CA is not pinned (`rejectUnauthorized: false`).
- Frontend is containerized (nginx) but has no AWS hosting in Terraform (S3 + CloudFront would be the choice; SSE
  through CloudFront needs care with origin timeouts).
- No frontend tests; backend tests run against a real Postgres rather than mocks (by design) so they need Docker.
- Single NAT gateway (cost) is a single-AZ egress point.

## Repository layout

```
backend/    src/{ai,auth,db,extractions}, test/, Dockerfile
frontend/   src/{pages,components}, nginx.conf, Dockerfile
infra/      terraform/
docs/       data-and-privacy.md · evaluation.md · infrastructure.md · cost-estimate.md
```

## Next steps if this were a real product
RAG over a company knowledge base (pgvector + embeddings) to ground priority/category rules; async batch processing
via SQS + workers for bulk imports; golden-set eval in CI (see evaluation doc); multi-tenant orgs with per-tenant
prompts/budgets and row-level security; native structured outputs; dedicated PII detection.
