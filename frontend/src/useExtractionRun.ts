import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, streamExtraction, type Extraction, type RunPayload } from './api';

export type Stage = 'checking' | 'generating' | 'validating' | 'retrying';

export interface RunState {
  phase: 'idle' | 'running' | 'error';
  stage: Stage | null;
  preview: string; // raw partial model output, shown while "thinking"
  error: string | null;
}

const idle: RunState = { phase: 'idle', stage: null, preview: '', error: null };

/** Owns the lifecycle of one streamed AI request: status, partial output, cancellation, errors. */
export function useExtractionRun(onDone: (e: Extraction, meta: { cached: boolean; warnings: string[] }) => void) {
  const [state, setState] = useState<RunState>(idle);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (payload: RunPayload) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setState({ phase: 'running', stage: 'checking', preview: '', error: null });
      try {
        await streamExtraction(
          payload,
          (ev) => {
            if (ev.type === 'status') setState((s) => ({ ...s, stage: ev.stage, preview: ev.stage === 'retrying' ? '' : s.preview }));
            else if (ev.type === 'delta') setState((s) => ({ ...s, preview: s.preview + ev.text }));
            else if (ev.type === 'result') {
              setState(idle);
              onDone(ev.extraction, { cached: ev.cached, warnings: ev.warnings });
            } else setState({ phase: 'error', stage: null, preview: '', error: ev.message });
          },
          ac.signal,
        );
      } catch (err) {
        if ((err as Error).name === 'AbortError') return setState(idle);
        const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
        setState({ phase: 'error', stage: null, preview: '', error: message });
      }
    },
    [onDone],
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => setState(idle), []);
  return { state, run, cancel, reset };
}
