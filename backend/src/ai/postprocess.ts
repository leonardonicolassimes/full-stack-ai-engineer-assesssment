import { modelOutputSchema, type ExtractionResult } from './schema.js';

export type ParseOutcome = { ok: true; result: ExtractionResult } | { ok: false; error: string };

const LOW_CONFIDENCE = 0.6;

function extractJson(raw: string): unknown {
  const stripped = raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // Models occasionally wrap JSON in prose; take the outermost object.
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object found');
    return JSON.parse(stripped.slice(start, end + 1));
  }
}

/**
 * Response post-processing: parse -> schema-validate -> ground -> flag uncertainty.
 * The model is never trusted: invalid output is rejected, ungrounded entities are
 * dropped, and low confidence is surfaced as needs_review for the UI.
 */
export function postProcess(raw: string, ticket: string): ParseOutcome {
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch (e) {
    return { ok: false, error: `output is not valid JSON (${(e as Error).message})` };
  }
  const parsed = modelOutputSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    return { ok: false, error: `schema violation: ${issues}` };
  }

  const out = parsed.data;
  const reasons: string[] = [];

  // Hallucination guard: entities must literally appear in the ticket.
  const haystack = ticket.toLowerCase();
  const grounded = out.entities.filter((e) => haystack.includes(e.value.toLowerCase()));
  const dropped = out.entities.length - grounded.length;
  if (dropped > 0) reasons.push(`${dropped} extracted entit${dropped === 1 ? 'y was' : 'ies were'} not found in the text and removed`);

  for (const [field, value] of Object.entries(out.confidence)) {
    if (value < LOW_CONFIDENCE) reasons.push(`low confidence on ${field} (${value.toFixed(2)})`);
  }
  if (out.uncertainty_notes) reasons.push(`model note: ${out.uncertainty_notes}`);

  return {
    ok: true,
    result: { ...out, entities: grounded, needs_review: reasons.length > 0, review_reasons: reasons },
  };
}
