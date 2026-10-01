import { useState } from 'react';
import { api, type Extraction, type ExtractionResult } from '../api';

const label = (s: string) => s.replace(/_/g, ' ');

function level(v: number) {
  return v >= 0.8 ? { text: 'High', cls: 'high' } : v >= 0.6 ? { text: 'Medium', cls: 'mid' } : { text: 'Low', cls: 'low' };
}

function Confidence({ name, value }: { name: string; value: number }) {
  const l = level(value);
  return (
    <div className="conf" title={`${name} confidence ${(value * 100).toFixed(0)}%`}>
      <span className="small muted">{name} confidence</span>
      <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={value} aria-label={`${name} confidence`}>
        <div className={`fill ${l.cls}`} style={{ width: `${value * 100}%` }} />
      </div>
      <span className={`small tag ${l.cls}`}>{l.text}</span>
    </div>
  );
}

function Field({ name, value, conf }: { name: string; value: string; conf: number }) {
  return (
    <div className="field">
      <span className="small muted">{name}</span>
      <span className={`badge ${name === 'priority' ? value : ''}`}>{label(value)}</span>
      <Confidence name={name} value={conf} />
    </div>
  );
}

export function ResultView({ extraction, cached, warnings }: { extraction: Extraction; cached?: boolean; warnings?: string[] }) {
  const r: ExtractionResult | null = extraction.result;
  const [vote, setVote] = useState<number | null>(extraction.feedback);
  const [voteError, setVoteError] = useState(false);

  async function sendFeedback(v: 1 | -1) {
    setVoteError(false);
    const prev = vote;
    setVote(v);
    try {
      await api.feedback(extraction.id, v);
    } catch {
      setVote(prev);
      setVoteError(true);
    }
  }

  if (extraction.status === 'failed' || !r) {
    return <p className="alert error" role="alert">This analysis failed: {extraction.error ?? 'unknown error'}. You can try again from History.</p>;
  }

  return (
    <section className="card result" aria-live="polite">
      {warnings?.map((w) => <p key={w} className="alert info">ℹ️ {w}</p>)}

      {r.needs_review && (
        <div className="alert warn" role="note">
          <strong>The AI is not fully certain. Please verify before acting on this.</strong>
          <ul>{r.review_reasons.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}

      <h2>Summary</h2>
      <p className="summary">{r.summary}</p>

      <div className="grid3">
        <Field name="category" value={r.category} conf={r.confidence.category} />
        <Field name="priority" value={r.priority} conf={r.confidence.priority} />
        <Field name="sentiment" value={r.sentiment} conf={r.confidence.sentiment} />
      </div>

      <h3>Entities <span className="small muted">(only values found verbatim in your text)</span></h3>
      {r.entities.length ? (
        <ul className="chips">{r.entities.map((e, i) => <li key={i}><span className="small muted">{label(e.type)}</span> {e.value}</li>)}</ul>
      ) : (
        <p className="muted">No entities found.</p>
      )}

      <footer className="meta small muted">
        {cached && <span className="tag">cached result — no new AI call</span>}
        <span>{extraction.model}</span>
        <span>prompt {extraction.prompt_version}</span>
        {extraction.latency_ms != null && <span>{(extraction.latency_ms / 1000).toFixed(1)}s</span>}
        <span className="spacer" />
        <span>Was this correct?</span>
        <button className={`icon ${vote === 1 ? 'on' : ''}`} aria-label="Mark as correct" aria-pressed={vote === 1} onClick={() => sendFeedback(1)}>👍</button>
        <button className={`icon ${vote === -1 ? 'on' : ''}`} aria-label="Mark as wrong" aria-pressed={vote === -1} onClick={() => sendFeedback(-1)}>👎</button>
        {voteError && <span className="error-text">Could not save feedback</span>}
      </footer>
    </section>
  );
}
