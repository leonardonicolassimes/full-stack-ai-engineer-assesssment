import { pool } from '../db/pool.js';
import type { ExtractionResult } from '../ai/schema.js';

export const COLUMNS = `id, parent_id, status, input_text, instruction, result, error, prompt_version,
  model, tokens_in, tokens_out, cost_usd, latency_ms, feedback, created_at`;

export interface ExtractionRow {
  id: string;
  parent_id: string | null;
  status: 'pending' | 'completed' | 'failed';
  input_text: string;
  instruction: string | null;
  result: ExtractionResult | null;
  error: string | null;
  prompt_version: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: string | null;
  latency_ms: number | null;
  feedback: number | null;
  created_at: string;
}

export async function findOwned(userId: string, id: string): Promise<ExtractionRow | undefined> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM extractions WHERE id=$1 AND user_id=$2`, [id, userId]);
  return rows[0];
}

export async function findCached(
  userId: string,
  hash: string,
  promptVersion: string,
  model: string,
): Promise<ExtractionRow | undefined> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM extractions
     WHERE user_id=$1 AND input_hash=$2 AND prompt_version=$3 AND model=$4
       AND status='completed' AND instruction IS NULL AND parent_id IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [userId, hash, promptVersion, model],
  );
  return rows[0];
}

export async function tokensUsedLast24h(userId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(COALESCE(tokens_in,0) + COALESCE(tokens_out,0)), 0)::int AS used
     FROM extractions WHERE user_id=$1 AND created_at > now() - interval '24 hours'`,
    [userId],
  );
  return rows[0].used;
}

export async function insertPending(p: {
  userId: string;
  parentId?: string;
  inputText: string;
  hash: string;
  instruction?: string;
  promptVersion: string;
  model: string;
}): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO extractions (user_id, parent_id, input_text, input_hash, instruction, prompt_version, model)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [p.userId, p.parentId ?? null, p.inputText, p.hash, p.instruction ?? null, p.promptVersion, p.model],
  );
  return rows[0].id;
}

export async function complete(
  id: string,
  p: { result: ExtractionResult; tokensIn: number; tokensOut: number; costUsd: number; latencyMs: number },
): Promise<ExtractionRow> {
  const { rows } = await pool.query(
    `UPDATE extractions SET status='completed', result=$2, tokens_in=$3, tokens_out=$4, cost_usd=$5, latency_ms=$6
     WHERE id=$1 RETURNING ${COLUMNS}`,
    [id, p.result, p.tokensIn, p.tokensOut, p.costUsd, p.latencyMs],
  );
  return rows[0];
}

export async function fail(
  id: string,
  p: { error: string; tokensIn?: number; tokensOut?: number; costUsd?: number; latencyMs: number },
): Promise<ExtractionRow> {
  const { rows } = await pool.query(
    `UPDATE extractions SET status='failed', error=$2, tokens_in=$3, tokens_out=$4, cost_usd=$5, latency_ms=$6
     WHERE id=$1 RETURNING ${COLUMNS}`,
    [id, p.error, p.tokensIn ?? 0, p.tokensOut ?? 0, p.costUsd ?? 0, p.latencyMs],
  );
  return rows[0];
}

/** Retention: hard-delete expired AI inputs/outputs. Returns how many rows were removed. */
export async function purgeExpired(): Promise<number> {
  const { rowCount } = await pool.query('DELETE FROM extractions WHERE expires_at <= now()');
  return rowCount ?? 0;
}
