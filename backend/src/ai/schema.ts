import { z } from 'zod';

export const CATEGORIES = [
  'billing',
  'technical_issue',
  'account_access',
  'feature_request',
  'shipping_delivery',
  'refund_return',
  'other',
] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const SENTIMENTS = ['negative', 'neutral', 'positive'] as const;
export const ENTITY_TYPES = ['person', 'product', 'order_id', 'date', 'amount', 'other'] as const;

const confidence = z.number().min(0).max(1);

/** Shape the model is asked to produce. Anything else is rejected. */
export const modelOutputSchema = z.object({
  summary: z.string().min(1).max(500),
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  sentiment: z.enum(SENTIMENTS),
  entities: z.array(z.object({ type: z.enum(ENTITY_TYPES), value: z.string().min(1).max(200) })).max(20),
  confidence: z.object({ category: confidence, priority: confidence, sentiment: confidence }),
  uncertainty_notes: z.string().max(300).nullable().default(null),
});
export type ModelOutput = z.infer<typeof modelOutputSchema>;

/** What we persist and return: model output + our own reliability signals. */
export interface ExtractionResult extends ModelOutput {
  needs_review: boolean;
  review_reasons: string[];
}
