import { config } from '../../config.js';
import { AnthropicProvider } from './anthropic.js';
import { MockProvider } from './mock.js';
import type { LLMProvider } from './types.js';

export type { LLMProvider, LLMRequest, LLMResult } from './types.js';

// USD per million tokens (input, output). Keep in sync with provider pricing pages.
const PRICING: Record<string, [number, number]> = {
  'claude-haiku-4-5-20251001': [1, 5],
};

export function estimateCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const [pin, pout] = PRICING[model] ?? [0, 0];
  return (tokensIn * pin + tokensOut * pout) / 1_000_000;
}

let instance: LLMProvider | undefined;

/** Single switch point for swapping providers: set LLM_PROVIDER. */
export function getProvider(): LLMProvider {
  instance ??=
    config.LLM_PROVIDER === 'anthropic'
      ? new AnthropicProvider(config.ANTHROPIC_API_KEY!, config.ANTHROPIC_MODEL)
      : new MockProvider();
  return instance;
}

/** Test seam. */
export function setProvider(p: LLMProvider | undefined) {
  instance = p;
}
