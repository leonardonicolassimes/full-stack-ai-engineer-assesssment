import { config } from '../config.js';
import { AppError } from '../errors.js';
import { audit } from '../audit.js';
import { guardInput } from '../ai/guard.js';
import { getPrompt } from '../ai/prompts/index.js';
import { estimateCostUsd, getProvider, type LLMResult } from '../ai/providers/index.js';
import { postProcess } from '../ai/postprocess.js';
import * as repo from './repo.js';

export interface RunInput {
  userId: string;
  text?: string;
  instruction?: string;
  parentId?: string;
}

export type StreamEvent =
  | { type: 'status'; stage: 'checking' | 'generating' | 'validating' | 'retrying' }
  | { type: 'delta'; text: string }
  | { type: 'result'; extraction: repo.ExtractionRow; cached: boolean; warnings: string[] }
  | { type: 'error'; message: string };

export interface RunOptions {
  emit?: (e: StreamEvent) => void;
  signal?: AbortSignal;
}

/**
 * Orchestrates one AI interaction:
 *   guard -> budget -> (cache) -> prompt -> provider -> post-process (+1 repair retry) -> persist.
 * Each stage lives in its own module; this file only sequences them.
 */
export async function runExtraction(input: RunInput, opts: RunOptions = {}) {
  const { emit, signal } = opts;
  emit?.({ type: 'status', stage: 'checking' });

  // 1. Resolve source text (a refinement reuses the already-masked parent text).
  const parent = input.parentId ? await repo.findOwned(input.userId, input.parentId) : undefined;
  if (input.parentId && !parent) throw new AppError(404, 'Parent extraction not found');
  if (!input.text && !parent) throw new AppError(400, 'text is required');

  const ticket = input.text ? guardInput(input.text, { label: 'text' }) : guardInput(parent!.input_text);
  const refinement = input.instruction ? guardInput(input.instruction, { maxChars: 500, label: 'instruction' }) : undefined;

  const warnings: string[] = [];
  const signals = [...ticket.injectionSignals, ...(refinement?.injectionSignals ?? [])];
  if (signals.length) warnings.push('Input contains text that looks like instructions to the AI. It was treated as data only.');
  if (Object.keys(ticket.piiMasked).length) warnings.push('Personal data was detected and masked before processing.');

  // 2. Cost control: per-user rolling 24h token budget.
  const used = await repo.tokensUsedLast24h(input.userId);
  if (used >= config.DAILY_TOKEN_BUDGET) throw new AppError(429, 'Daily AI usage limit reached. Try again later.');

  const provider = getProvider();
  const prompt = getPrompt();

  // 3. Cache: identical input + prompt + model returns the stored result, no LLM spend.
  if (!refinement && !parent) {
    const hit = await repo.findCached(input.userId, ticket.hash, prompt.version, provider.model);
    if (hit) {
      const ev = { type: 'result', extraction: hit, cached: true, warnings } as const;
      emit?.(ev);
      return ev;
    }
  }

  const id = await repo.insertPending({
    userId: input.userId,
    parentId: parent?.id,
    inputText: ticket.text,
    hash: ticket.hash,
    instruction: refinement?.text,
    promptVersion: prompt.version,
    model: provider.model,
  });

  const started = Date.now();
  let tokensIn = 0;
  let tokensOut = 0;
  const call = async (repairHint?: string): Promise<LLMResult> => {
    const req = {
      system: prompt.system,
      user: prompt.buildUser({
        ticket: ticket.text,
        instruction: refinement?.text,
        previousResult: parent?.result ?? undefined,
        repairHint,
      }),
      maxTokens: config.MAX_OUTPUT_TOKENS,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(config.LLM_TIMEOUT_MS)]) : AbortSignal.timeout(config.LLM_TIMEOUT_MS),
    };
    const res = emit
      ? await provider.stream(req, (text) => emit({ type: 'delta', text }))
      : await provider.complete(req);
    tokensIn += res.tokensIn;
    tokensOut += res.tokensOut;
    return res;
  };

  try {
    emit?.({ type: 'status', stage: 'generating' });
    let res = await call();
    emit?.({ type: 'status', stage: 'validating' });
    let outcome = postProcess(res.text, ticket.text);

    if (!outcome.ok) {
      // One repair attempt with the concrete validation error, then give up.
      emit?.({ type: 'status', stage: 'retrying' });
      res = await call(outcome.error);
      outcome = postProcess(res.text, ticket.text);
    }
    if (!outcome.ok) throw new AppError(502, `The AI returned an unusable answer (${outcome.error}).`);

    const extraction = await repo.complete(id, {
      result: outcome.result,
      tokensIn,
      tokensOut,
      costUsd: estimateCostUsd(provider.model, tokensIn, tokensOut),
      latencyMs: Date.now() - started,
    });
    // Audit stores metadata only, never content.
    await audit(input.userId, 'extraction.create', id, {
      model: provider.model,
      prompt_version: prompt.version,
      tokens: tokensIn + tokensOut,
      pii_masked: ticket.piiMasked,
      injection_signals: signals,
      needs_review: outcome.result.needs_review,
    });
    const ev = { type: 'result', extraction, cached: false, warnings } as const;
    emit?.(ev);
    return ev;
  } catch (err) {
    const aborted = signal?.aborted;
    const message = aborted
      ? 'Request cancelled'
      : err instanceof AppError
        ? err.message
        : (err as Error).name === 'TimeoutError'
          ? 'The AI provider timed out'
          : 'The AI provider failed';
    await repo.fail(id, {
      error: message,
      tokensIn,
      tokensOut,
      costUsd: estimateCostUsd(provider.model, tokensIn, tokensOut),
      latencyMs: Date.now() - started,
    });
    if (err instanceof AppError) throw err;
    throw new AppError(aborted ? 499 : 502, message);
  }
}
