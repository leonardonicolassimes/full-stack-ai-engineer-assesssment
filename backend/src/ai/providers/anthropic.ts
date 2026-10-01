import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMRequest, LLMResult } from './types.js';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    // SDK retries 429/5xx with backoff; we keep it low so total latency stays bounded.
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  async complete(req: LLMRequest): Promise<LLMResult> {
    const res = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      },
      { signal: req.signal },
    );
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return { text, model: res.model, tokensIn: res.usage.input_tokens, tokensOut: res.usage.output_tokens };
  }

  async stream(req: LLMRequest, onDelta: (text: string) => void): Promise<LLMResult> {
    const stream = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        stream: true,
      },
      { signal: req.signal },
    );
    let text = '';
    let tokensIn = 0;
    let tokensOut = 0;
    for await (const event of stream) {
      if (event.type === 'message_start') tokensIn = event.message.usage.input_tokens;
      else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text;
        onDelta(event.delta.text);
      } else if (event.type === 'message_delta') tokensOut = event.usage.output_tokens;
    }
    return { text, model: this.model, tokensIn, tokensOut };
  }
}
