export type Category =
  | 'billing' | 'technical_issue' | 'account_access' | 'feature_request' | 'shipping_delivery' | 'refund_return' | 'other';

export interface ExtractionResult {
  summary: string;
  category: Category;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  sentiment: 'negative' | 'neutral' | 'positive';
  entities: { type: string; value: string }[];
  confidence: { category: number; priority: number; sentiment: number };
  uncertainty_notes: string | null;
  needs_review: boolean;
  review_reasons: string[];
}

export interface Extraction {
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

export interface RunPayload {
  text?: string;
  instruction?: string;
  parentId?: string;
}

export type StreamEvent =
  | { type: 'status'; stage: 'checking' | 'generating' | 'validating' | 'retrying' }
  | { type: 'delta'; text: string }
  | { type: 'result'; extraction: Extraction; cached: boolean; warnings: string[] }
  | { type: 'error'; message: string };

const TOKEN_KEY = 'token';
// Trade-off: localStorage is simple but readable by XSS. Production would use an httpOnly, SameSite cookie.
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }
  if (res.status === 401 && token) onUnauthorized();
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: { id: string; email: string } }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string) =>
    request<{ token: string; user: { id: string; email: string } }>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request<{ id: string; email: string }>('/auth/me'),
  list: (limit = 50, offset = 0) => request<{ items: Extraction[] }>(`/extractions?limit=${limit}&offset=${offset}`),
  get: (id: string) => request<Extraction>(`/extractions/${id}`),
  remove: (id: string) => request<void>(`/extractions/${id}`, { method: 'DELETE' }),
  feedback: (id: string, value: 1 | -1) =>
    request<void>(`/extractions/${id}/feedback`, { method: 'POST', body: JSON.stringify({ value }) }),
};

/** POST + Server-Sent Events over fetch (EventSource cannot send a body or auth header). */
export async function streamExtraction(
  payload: RunPayload,
  onEvent: (e: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch('/api/extractions/stream', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }
  if (res.status === 401) onUnauthorized();
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let sawTerminal = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = block.split('\n').find((l) => l.startsWith('data: '));
      if (!data) continue;
      const event = JSON.parse(data.slice(6)) as StreamEvent;
      if (event.type === 'result' || event.type === 'error') sawTerminal = true;
      onEvent(event);
    }
  }
  if (!sawTerminal) throw new ApiError(0, 'The connection was interrupted before the AI finished.');
}
