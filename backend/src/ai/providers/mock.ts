import { config } from '../../config.js';
import type { LLMProvider, LLMRequest, LLMResult } from './types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CATEGORY_RULES: [string, RegExp][] = [
  ['refund_return', /refund|return|money back|reembolso|devoluci/i],
  ['billing', /invoice|charge|billed|payment|factura|cobro|cargo/i],
  ['account_access', /password|login|log in|locked|2fa|contrase|acceso/i],
  ['shipping_delivery', /shipping|delivery|package|tracking|envío|envio|paquete/i],
  ['feature_request', /feature|would be great|please add|suggest|sugerencia/i],
  ['technical_issue', /error|crash|bug|not working|broken|down|fails|falla|no funciona/i],
];

/**
 * Deterministic stand-in for an LLM. It reads the same prompt contract as a real
 * model (the <ticket> block), so the whole pipeline is exercised without an API key.
 * Not a quality baseline: it is a test double and demo provider.
 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock';
  readonly model = 'mock-heuristic-1';

  private generate(req: LLMRequest): string {
    const ticket = /<ticket>\n([\s\S]*?)\n<\/ticket>/.exec(req.user)?.[1] ?? '';
    const instruction = /<refinement>\n([\s\S]*?)\n<\/refinement>/.exec(req.user)?.[1];

    const hit = CATEGORY_RULES.find(([, re]) => re.test(ticket));
    const category = hit?.[0] ?? 'other';
    const urgent = /urgent|asap|immediately|urgente|ya mismo|down|can't access/i.test(ticket);
    const angry = /terrible|worst|angry|unacceptable|furious|horrible|pésimo|inaceptable/i.test(ticket);
    const happy = /thanks|thank you|great|love|excellent|gracias|excelente/i.test(ticket);

    const entities: { type: string; value: string }[] = [];
    for (const m of ticket.matchAll(/#?\b(?:ORD|INV|TKT)?-?\d{5,}\b/g)) entities.push({ type: 'order_id', value: m[0] });
    for (const m of ticket.matchAll(/(?:\$|USD\s?|€)\s?\d+(?:[.,]\d{1,2})?/g)) entities.push({ type: 'amount', value: m[0] });

    const short = ticket.length < 25;
    const base = hit ? 0.85 : 0.45;
    const firstSentence = ticket.split(/(?<=[.!?])\s/)[0]?.slice(0, 200) ?? ticket.slice(0, 200);

    return JSON.stringify({
      summary: firstSentence,
      category,
      priority: urgent ? 'urgent' : angry ? 'high' : category === 'feature_request' ? 'low' : 'medium',
      sentiment: angry ? 'negative' : happy ? 'positive' : 'neutral',
      entities: entities.slice(0, 10),
      confidence: {
        category: short ? 0.4 : base,
        priority: urgent || angry ? 0.8 : 0.6,
        sentiment: angry || happy ? 0.85 : 0.65,
      },
      uncertainty_notes: short
        ? 'Ticket is very short; classification is a guess.'
        : instruction
          ? `Refinement considered: ${instruction.slice(0, 120)}`
          : null,
    });
  }

  async complete(req: LLMRequest): Promise<LLMResult> {
    if (config.MOCK_DELAY_MS) await sleep(config.MOCK_DELAY_MS * 10);
    req.signal?.throwIfAborted();
    const text = this.generate(req);
    return this.usage(req, text);
  }

  async stream(req: LLMRequest, onDelta: (text: string) => void): Promise<LLMResult> {
    const text = this.generate(req);
    for (let i = 0; i < text.length; i += 12) {
      req.signal?.throwIfAborted();
      if (config.MOCK_DELAY_MS) await sleep(config.MOCK_DELAY_MS);
      onDelta(text.slice(i, i + 12));
    }
    return this.usage(req, text);
  }

  private usage(req: LLMRequest, text: string): LLMResult {
    // ~4 chars per token heuristic
    return {
      text,
      model: this.model,
      tokensIn: Math.ceil((req.system.length + req.user.length) / 4),
      tokensOut: Math.ceil(text.length / 4),
    };
  }
}
