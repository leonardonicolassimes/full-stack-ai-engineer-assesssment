# Infrastructure, secrets and scaling

Terraform: `infra/terraform` (AWS provider ~> 5). Status: `terraform validate` ✅, `terraform plan` offline with
`mock_mode` ✅ (39 resources). **Never applied.**

## Topology

```
Internet ─▶ ALB (public subnets, :443)  ─▶ ECS Fargate tasks (private subnets) ─▶ RDS PostgreSQL (private, encrypted)
                                                │
                                                └─▶ NAT ─▶ LLM API / ECR / Secrets Manager / CloudWatch
```

Security groups form a chain: `internet → ALB`, `ALB → app :3000`, `app → db :5432` — nothing else. Tasks have no
public IP. The task IAM role (what the *code* may do in AWS) is empty; the execution role (what ECS may do to
*start* the task) can read exactly three secrets.

## Config vs code vs secrets

| Kind | Example | Where it lives |
|---|---|---|
| Code | app, prompts, schema | Git → image in ECR (immutable tags) |
| Config (non-secret) | `LLM_PROVIDER`, `PROMPT_VERSION`, `DAILY_TOKEN_BUDGET`, `CORS_ORIGIN`, DB host | Terraform variables → task-definition `environment` |
| Secrets | `ANTHROPIC_API_KEY`, `JWT_SECRET`, DB password | AWS Secrets Manager → task-definition `secrets` (resolved by ECS at start; never plaintext in the task definition) |

The same image runs in every environment; only config/secrets differ. Locally, `.env` (git-ignored) with
`.env.example` as the template; the app refuses to start on invalid/missing config (Zod).

## Where the AI API key lives and how it is rotated

- **Lives in**: Secrets Manager secret `ticket-extractor/anthropic-api-key` (encrypted with KMS). Terraform creates
  only the empty *container*, so the value is never in code, CI logs or Terraform state. One-time bootstrap by a
  human/ops role:

  ```bash
  aws secretsmanager put-secret-value --secret-id ticket-extractor/anthropic-api-key --secret-string "$KEY"
  ```
- **Access**: only the ECS execution role (`secretsmanager:GetSecretValue` on 3 ARNs). Developers do not need it.
  Use a customer-managed KMS key + CloudTrail data events on the secret for an access audit trail.
- **Rotation (zero downtime)**: LLM providers allow multiple active keys, so rotation is *create → switch → revoke*:
  1. create a new key at the provider (dedicated per environment, with a spend limit),
  2. `put-secret-value` (new version; the previous stays as `AWSPREVIOUS`),
  3. `aws ecs update-service --force-new-deployment` — tasks restart with rolling deploy and pick up the new value
     (ECS injects secrets at task start),
  4. verify, then revoke the old key at the provider.
  Automate with a Secrets Manager rotation Lambda on a 90-day schedule plus an EventBridge rule that triggers the
  redeploy. Emergency revocation uses the same path (minutes).
- The DB password is rotated by RDS/Secrets Manager natively (managed master user password).

## Scaling under bursty AI usage

What is different about AI workloads: requests are **long (seconds), I/O-bound, and rate-limited by the provider**.
CPU stays low while connections pile up, so CPU-only autoscaling reacts too late.

Implemented:
- Target tracking on **ALB requests per target** (primary) and CPU (safety net); fast scale-out (30 s), slow
  scale-in (5 min) to avoid flapping; min 2 tasks across 2 AZs; max 20.
- ALB idle timeout 120 s and deregistration delay 120 s with container `stopTimeout` 120 s so streams in flight
  finish during deploys and scale-in.
- Deployment circuit breaker with automatic rollback.
- Per-user and global rate limits and token budgets protect both the provider quota and the bill.

Would add:
- **Provider concurrency is the real ceiling**, not our tasks. Scaling to 100 tasks just produces 429s from the
  provider if the account's rate limit is lower. Mitigations: a shared concurrency limiter (Redis semaphore),
  exponential backoff with jitter (SDK retries 429/5xx already), and graceful degradation (queue or "try again").
- **Queue-backed async mode** for non-interactive bursts: API enqueues to SQS, workers consume at a controlled rate
  (scale workers on queue depth / age of oldest message), results are polled or pushed. Interactive requests keep
  the synchronous/SSE path with priority.
- **Multi-provider / model fallback** behind the existing `LLMProvider` interface when one provider is degraded.
- RDS connection management (pool is 10/task; at 20 tasks use RDS Proxy), read replica if history queries grow.
- Pre-warm (higher `min_tasks`) on predictable peaks via scheduled scaling.

## Containers and deployment

- `backend/Dockerfile`: multi-stage, non-root user, production deps only, container `HEALTHCHECK`. Image ≈ 296 MB.
- `frontend/Dockerfile`: static build served by nginx, `/api` proxied to the API with buffering disabled for SSE.
- Chosen runtime: **ECS on Fargate** — no cluster to patch, per-second billing, fits stateless HTTP service. EKS
  would be justified only with an existing platform team; Lambda is a poor fit for multi-second streamed responses
  and the DB connection pool.
- Deploy flow: build → push to ECR (immutable tag = git SHA) → run **migration as a one-off task** (`migrate_command`
  Terraform output) → update service (rolling, with circuit breaker).

## AI-specific scaling constraints (summary)
1. Provider rate limits (RPM/TPM) bound throughput regardless of our capacity.
2. Long-lived connections (SSE) hold task and ALB capacity; cap max stream duration, scale on concurrency.
3. Cost scales linearly with traffic *and* retries; repair retries and cache hit rate directly change the bill.
4. Latency is dominated by the model (seconds) and varies; timeouts and cancellation are essential to avoid
   paying for abandoned work.
5. Cold paths (new prompt version) invalidate the cache — expect a cost/latency bump after prompt changes.
