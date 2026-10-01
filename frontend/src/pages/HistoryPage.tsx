import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Extraction } from '../api';

export function HistoryPage() {
  const [items, setItems] = useState<Extraction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.list().then((r) => setItems(r.items)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function remove(id: string) {
    if (!confirm('Delete this analysis permanently?')) return;
    try {
      await api.remove(id);
      setItems((xs) => xs?.filter((x) => x.id !== id) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="stack">
      <h1>History</h1>
      <p className="muted small">Analyses are kept for 30 days and then deleted automatically.</p>
      {error && <div className="alert error" role="alert">{error} <button className="link" onClick={load}>Retry</button></div>}
      {!items && !error && <p className="muted" role="status">Loading…</p>}
      {items?.length === 0 && (
        <div className="card empty">
          <p><strong>No analyses yet.</strong></p>
          <p className="muted">Analyze your first ticket to see it here.</p>
          <Link to="/" className="button primary">Analyze a ticket</Link>
        </div>
      )}
      <ul className="list">
        {items?.map((x) => (
          <li key={x.id} className="card row">
            <div className="grow">
              <Link to={`/e/${x.id}`}><strong>{x.result?.summary ?? x.input_text.slice(0, 80)}</strong></Link>
              <div className="small muted">
                {new Date(x.created_at).toLocaleString()}
                {x.result && <> · {x.result.category.replace(/_/g, ' ')} · {x.result.priority}</>}
                {x.parent_id && ' · refinement'}
              </div>
            </div>
            {x.status === 'failed' && <span className="tag low">failed</span>}
            {x.result?.needs_review && <span className="tag mid">needs review</span>}
            <button className="link" onClick={() => remove(x.id)} aria-label="Delete analysis">Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
