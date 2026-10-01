import { useCallback, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Extraction } from '../api';
import { useExtractionRun, type Stage } from '../useExtractionRun';
import { ResultView } from './ResultView';

const MAX_CHARS = 8000;
const STAGE_TEXT: Record<Stage, string> = {
  checking: 'Checking your input…',
  generating: 'The AI is analyzing the ticket…',
  validating: 'Verifying the AI’s answer…',
  retrying: 'The answer was malformed. Retrying once…',
};

const SAMPLES = [
  'URGENT: I was charged $49.99 twice for order 20481736. This is unacceptable, please refund me.',
  'The mobile app crashes with an error every time I open Settings. Version 3.2 on Android 14.',
  'Would be great if you could add dark mode and CSV export. Thanks, love the product!',
];

/** Input -> streamed analysis -> result -> refine loop. Used for both new and existing extractions. */
export function Workspace({ initial }: { initial?: Extraction }) {
  const [current, setCurrent] = useState<Extraction | undefined>(initial);
  const [meta, setMeta] = useState<{ cached: boolean; warnings: string[] }>({ cached: false, warnings: [] });
  const [text, setText] = useState('');
  const [instruction, setInstruction] = useState('');

  const onDone = useCallback((e: Extraction, m: { cached: boolean; warnings: string[] }) => {
    setCurrent(e);
    setMeta(m);
    setInstruction('');
  }, []);
  const { state, run, cancel, reset } = useExtractionRun(onDone);
  const running = state.phase === 'running';

  function submitNew(e: FormEvent) {
    e.preventDefault();
    run({ text });
  }
  function submitRefine(e: FormEvent) {
    e.preventDefault();
    if (current) run({ parentId: current.id, instruction });
  }
  function startOver() {
    setCurrent(undefined);
    setText('');
    reset();
  }

  const progress = running && (
    <div className="card progress" role="status" aria-live="polite">
      <div className="row">
        <span className="spinner" aria-hidden />
        <strong>{state.stage ? STAGE_TEXT[state.stage] : 'Working…'}</strong>
        <span className="spacer" />
        <button className="link" onClick={cancel}>Cancel</button>
      </div>
      {state.preview && (
        <details open>
          <summary className="small muted">Live model output (raw, not yet validated)</summary>
          <pre className="preview">{state.preview}</pre>
        </details>
      )}
    </div>
  );

  const errorBox = state.phase === 'error' && (
    <div className="alert error" role="alert">
      <strong>Could not complete the analysis.</strong> {state.error}
      <div className="row"><button onClick={reset}>Dismiss</button></div>
    </div>
  );

  if (!current) {
    return (
      <form onSubmit={submitNew} className="stack">
        <h1>Analyze a support ticket</h1>
        <p className="muted">Paste a ticket. The AI extracts category, priority, sentiment and key entities, and tells you how sure it is.</p>
        <label className="sr-only" htmlFor="ticket">Ticket text</label>
        <textarea id="ticket" rows={9} value={text} maxLength={MAX_CHARS} onChange={(e) => setText(e.target.value)}
          placeholder="Paste the customer message here…" disabled={running} required />
        <div className="row">
          <span className="small muted">{text.length}/{MAX_CHARS} · emails, phones and card numbers are masked before AI processing</span>
          <span className="spacer" />
          <button className="primary" disabled={running || !text.trim()}>{running ? 'Analyzing…' : 'Analyze'}</button>
        </div>
        <div className="row wrap">
          <span className="small muted">Try an example:</span>
          {SAMPLES.map((s, i) => <button type="button" key={i} className="chip-btn" disabled={running} onClick={() => setText(s)}>Example {i + 1}</button>)}
        </div>
        {progress}
        {errorBox}
      </form>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <h1>Analysis</h1>
        <span className="spacer" />
        <Link to="/history" className="small">History</Link>
        <button className="link" onClick={startOver}>+ New ticket</button>
      </div>
      <details className="card">
        <summary>Original ticket (as processed)</summary>
        <p className="quote">{current.input_text}</p>
      </details>
      {current.instruction && <p className="small muted">Refined with: “{current.instruction}”</p>}
      <ResultView key={current.id} extraction={current} cached={meta.cached} warnings={meta.warnings} />

      <form onSubmit={submitRefine} className="card stack">
        <label htmlFor="refine"><strong>Refine or re-ask</strong> <span className="small muted">Not right? Tell the AI what to focus on.</span></label>
        <input id="refine" value={instruction} maxLength={500} onChange={(e) => setInstruction(e.target.value)} disabled={running}
          placeholder="e.g. Focus on the refund request and treat it as high priority" />
        <div className="row">
          <button className="primary" disabled={running || !instruction.trim()}>Re-ask</button>
        </div>
      </form>
      {progress}
      {errorBox}
    </div>
  );
}
