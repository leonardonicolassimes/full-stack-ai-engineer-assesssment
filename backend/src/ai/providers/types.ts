export interface LLMRequest {
  system: string;
  user: string;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface LLMResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/** Provider-agnostic contract. Model invocation only: no prompts, no parsing. */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(req: LLMRequest): Promise<LLMResult>;
  stream(req: LLMRequest, onDelta: (text: string) => void): Promise<LLMResult>;
}
