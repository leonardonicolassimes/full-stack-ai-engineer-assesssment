import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { AppError } from '../errors.js';

export interface GuardedInput {
  text: string; // normalized + PII-masked: the only form that is stored or sent to the LLM
  hash: string;
  piiMasked: Record<string, number>;
  injectionSignals: string[];
}

const INJECTION_PATTERNS: [string, RegExp][] = [
  ['ignore-instructions', /ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions|prompts?|rules)/i],
  ['disregard-rules', /disregard\s+.{0,40}(instructions|rules|guidelines)/i],
  ['role-override', /\byou\s+are\s+now\b|\bact\s+as\s+(an?\s+)?(dan|developer|admin|root)\b/i],
  ['prompt-exfiltration', /(reveal|print|show|repeat|leak)\s+.{0,30}(system\s+prompt|instructions|api\s*key|secret)/i],
  ['tag-spoofing', /<\/?\s*(system|assistant|ticket|refinement|previous_result)\b/i],
  ['jailbreak', /\bjailbreak\b|\bdeveloper\s+mode\b/i],
];

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt && (n *= 2) > 9) n -= 9;
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function maskPii(text: string): { text: string; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  let out = text;

  out = out.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
    const digits = m.replace(/\D/g, '');
    if (!luhn(digits)) return m;
    bump('card');
    return '[CARD]';
  });
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, () => (bump('national_id'), '[ID]'));
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, () => (bump('email'), '[EMAIL]'));
  // Phones must contain separators or a leading +, so plain order numbers are left alone.
  out = out.replace(
    /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\b\d{2,4})[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g,
    () => (bump('phone'), '[PHONE]'),
  );
  return { text: out, counts };
}

// Built from code points so no invisible characters live in the source file.
const CONTROL_AND_INVISIBLE = new RegExp(
  "[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202E\u2060-\u2064]",
  "g",
);

function normalize(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(CONTROL_AND_INVISIBLE, "") // control + zero-width/bidi chars
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/**
 * Input safety layer. Injection detection is advisory (the ticket is *data* and
 * legitimately may contain odd text); hard defenses are structural: delimiting,
 * schema-validated output, no tools, and entity grounding. Signals are surfaced
 * to the user and the audit log.
 */
export function guardInput(raw: string, opts: { maxChars?: number; label?: string } = {}): GuardedInput {
  const max = opts.maxChars ?? config.MAX_INPUT_CHARS;
  const label = opts.label ?? 'text';
  if (typeof raw !== 'string') throw new AppError(400, `${label} must be a string`);
  if (raw.length > max) throw new AppError(413, `${label} exceeds ${max} characters`);

  const normalized = normalize(raw);
  if (!normalized) throw new AppError(400, `${label} is empty`);

  const injectionSignals = INJECTION_PATTERNS.filter(([, re]) => re.test(normalized)).map(([name]) => name);
  // Neutralize delimiter spoofing so input cannot close our <ticket> block.
  const defanged = normalized.replace(/<\s*\/?\s*(ticket|refinement|previous_result|system|assistant)\b[^>]*>?/gi, '[tag-removed]');
  const { text, counts } = maskPii(defanged);

  const hash = createHash('sha256').update(text.replace(/\s+/g, ' ').toLowerCase()).digest('hex');
  return { text, hash, piiMasked: counts, injectionSignals };
}
