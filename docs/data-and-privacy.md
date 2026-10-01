# Data flow, storage and privacy

## What is stored vs not

| Data | Stored? | Where | Notes |
|---|---|---|---|
| Account email | Yes | `users` | Lower-cased, unique |
| Password | **Hash only** | `users.password_hash` | bcrypt (cost 12); plaintext never stored or logged |
| Ticket text | Yes, **after PII masking** | `extractions.input_text` | Needed so the user can see history and so refinements have context |
| Raw ticket text (pre-masking) | **No** | — | Masking happens in memory before anything is persisted or sent to the LLM |
| Model output | Yes | `extractions.result` (JSONB) | Validated structured result only |
| Raw model output / streamed deltas | **No** | — | Streamed to the browser, not persisted; failed attempts keep only an error string |
| Prompt text | **No** (version id only) | `extractions.prompt_version` | The prompt is reproducible from the version in git |
| Operational metadata | Yes | `extractions` | model, tokens in/out, cost, latency, feedback |
| Audit events | Yes | `audit_log` | Who did what and when; **never content** |
| API keys / JWT secret | **No** | Secrets Manager | Injected at runtime, never in repo, image, task definition or Terraform state |

Data minimisation principle: store the structured result and the minimum context needed to explain/refine it.

## What leaves the system
Only the **masked** ticket text, our system prompt and the optional refinement are sent to the LLM provider. User
identity (email, user id) is never included in the prompt. In production the provider should be used under a
zero-data-retention / no-training agreement (check the provider's current terms for the account used).

## Retention
- `extractions.expires_at` defaults to **30 days** after creation. An hourly job (`src/retention.ts`) hard-deletes
  expired rows, and records a `retention.purge` audit entry with the count. Covered by a test.
- Users can delete any of their own analyses at any time (`DELETE /api/extractions/:id`), also audited.
- Deleting a user cascades to all their extractions.
- `audit_log` is retained longer (metadata only); it is append-only, enforced by a database trigger that rejects
  UPDATE/DELETE. In production, ship it to write-once storage (S3 Object Lock) and set an explicit retention
  period agreed with legal/compliance.
- RDS automated backups (7 days) will contain deleted data until they age out — state this in the privacy policy.

## PII handling
1. **Detect and mask before storage and before the LLM**: emails → `[EMAIL]`, Luhn-valid card numbers → `[CARD]`,
   phone numbers with separators → `[PHONE]`, US-style national IDs → `[ID]`. The user is told when masking happened.
2. The prompt instructs the model to treat placeholders as redacted data, not entities.
3. Entity grounding means the model cannot "invent" personal data that wasn't in the text.
4. **Limits (honest)**: regex masking misses names, postal addresses, free-form IDs and many non-US formats.
   Production should add a real PII detector (Presidio / Amazon Comprehend) and make masking policy configurable
   per tenant. Free text can always contain PII we don't recognise, which is why retention and deletion exist.

## Logging
- Structured JSON logs (Fastify/pino), shipped to CloudWatch (30-day retention).
- **Request/response bodies are never logged.** The `Authorization` header is redacted.
- Application logs carry ids, status codes, timings and error classes — not user content.
- Errors from the LLM provider are logged server-side but returned to clients as generic messages (tested), so
  keys, request ids or internals cannot leak through error text.

## Auditability
- `audit_log` rows: `user.register`, `user.login`, `extraction.create` (model, prompt version, token count, PII
  categories masked, injection signals, whether it needed review), `extraction.delete`, `retention.purge`.
- Every extraction row stores `prompt_version`, `model`, tokens, cost, latency → any answer can be traced to the
  exact configuration that produced it.
- Row access is always scoped by `user_id` (tested: user B gets 404 on user A's data).

## Access control
- JWT-authenticated API; every query filters by the authenticated user id.
- Production additions: row-level security in Postgres as defence in depth, SSO/MFA, and short-lived access tokens
  with refresh rotation.
