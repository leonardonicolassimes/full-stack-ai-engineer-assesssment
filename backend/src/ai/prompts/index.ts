import { config } from '../../config.js';
import { v1 } from './v1.js';

export interface PromptParams {
  ticket: string;
  instruction?: string;
  previousResult?: unknown;
  repairHint?: string;
}

/** Prompt construction only: no model calls, no I/O. Versioned so results are traceable. */
export interface PromptTemplate {
  version: string;
  system: string;
  buildUser(params: PromptParams): string;
}

const registry: Record<string, PromptTemplate> = { v1 };

export function getPrompt(version = config.PROMPT_VERSION): PromptTemplate {
  const p = registry[version];
  if (!p) throw new Error(`Unknown prompt version "${version}". Available: ${Object.keys(registry).join(', ')}`);
  return p;
}
