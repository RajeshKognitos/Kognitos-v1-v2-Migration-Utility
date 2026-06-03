'use client';

/**
 * Migration run page (Phase 3.5, FILE 4).
 *
 * Drives the whole live experience for one migration id:
 *   1. Claims the pending `File` (set by the home page) and POSTs it to
 *      `/api/migrate`, then consumes the SSE stream, advancing the 3-stage
 *      progress UI as events arrive.
 *   2. On a hard refresh (no pending file) it falls back to
 *      `GET /api/migrate/[id]/result` to rehydrate a finished run.
 *   3. On `done`, renders the {@link BundleViewer} below the progress stepper.
 *
 * "Retry" re-runs the full pipeline from the original file (the backend runs all
 * three stages in one request, so per-stage resumption isn't possible in the MVP).
 *
 * Long-run resilience: if the SSE connection drops *after* analyze completes, the
 * backend keeps running and persists its result — so instead of "Retry" (which
 * would double-bill), we enter a `disconnected` state that polls
 * `GET /api/migrate/[id]/result` until the saved result appears.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw, RotateCcw } from 'lucide-react';

import { BundleViewer } from '@/components/bundle/BundleViewer';
import { ActivityLog, type LogEntry, type LogLevel } from '@/components/progress/ActivityLog';
import {
  PipelineProgress,
  type StageState,
} from '@/components/progress/PipelineProgress';
import { takePendingUpload } from '@/lib/pending-upload';
import {
  consumeMigrationStream,
  type MigrationResult,
  type MigrationStage,
} from '@/lib/sse-client';

type Phase = 'running' | 'done' | 'error' | 'missing' | 'disconnected';

const PENDING: StageState = { status: 'pending', completed: 0, total: 0 };

interface Stages {
  extract: StageState;
  analyze: StageState;
  sop: StageState;
}

const INITIAL_STAGES: Stages = {
  extract: { ...PENDING },
  analyze: { ...PENDING },
  sop: { ...PENDING },
};

/**
 * All stages complete (for rehydration). Extract/analyze count processes; the
 * SOP stage counts business-process groups (one consolidated SOP each).
 */
const completedStages = (stored: MigrationResult): Stages => {
  const procs = stored.bundle.processCount;
  const groups = stored.sop.groups?.length ?? procs;
  return {
    extract: { status: 'complete', completed: procs, total: procs },
    analyze: { status: 'complete', completed: procs, total: procs },
    sop: { status: 'complete', completed: groups, total: groups },
  };
};

export default function MigrationPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [phase, setPhase] = useState<Phase>('running');
  const [stages, setStages] = useState<Stages>(INITIAL_STAGES);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [error, setError] = useState<{ stage: MigrationStage; message: string } | null>(
    null,
  );
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Held across retries; the pending-upload handoff is one-shot.
  const fileRef = useRef<File | null>(null);
  const startedRef = useRef(false);
  const logSeq = useRef(0);

  const pushLog = useCallback((level: LogLevel, message: string): void => {
    setLogs((prev) => [
      ...prev,
      { id: `${Date.now()}-${(logSeq.current += 1)}`, ts: Date.now(), level, message },
    ]);
  }, []);

  const run = useCallback(
    async (file: File): Promise<void> => {
      setPhase('running');
      setStages({
        extract: { status: 'active', completed: 0, total: 0 },
        analyze: { ...PENDING },
        sop: { ...PENDING },
      });
      setError(null);
      setResult(null);
      setLogs([]);
      pushLog('info', 'Uploading HAR and starting the migration pipeline\u2026');

      const body = new FormData();
      body.append('file', file);
      body.append('id', id);

      let response: Response;
      try {
        response = await fetch('/api/migrate', { method: 'POST', body });
      } catch {
        setError({ stage: 'extract', message: 'Could not reach the migration server.' });
        setPhase('error');
        return;
      }

      if (!response.ok || !response.body) {
        setError({
          stage: 'extract',
          message: `Server responded ${response.status}. Please retry.`,
        });
        setPhase('error');
        return;
      }

      // Track how far we got, so a dropped connection past analyze becomes a
      // "still running, poll for it" state rather than a billable retry.
      let pastAnalyze = false;
      let terminal = false;
      try {
        for await (const event of consumeMigrationStream(response)) {
          switch (event.type) {
            case 'extract_started':
              setStages((s) => ({ ...s, extract: { status: 'active', completed: 0, total: 0 } }));
              pushLog('info', 'Extracting processes from the HAR\u2026');
              break;
            case 'extract_complete':
              setStages((s) => ({
                ...s,
                extract: {
                  status: 'complete',
                  completed: event.processCount,
                  total: event.processCount,
                },
              }));
              pushLog(
                'success',
                `Extracted ${event.processCount} process${event.processCount === 1 ? '' : 'es'}` +
                  (event.books.length > 0 ? ` \u00b7 books: ${event.books.join(', ')}` : ''),
              );
              break;
            case 'analyze_started':
              setStages((s) => ({
                ...s,
                analyze: { status: 'active', completed: 0, total: event.total },
              }));
              pushLog('info', `Analyzing ${event.total} process${event.total === 1 ? '' : 'es'} into IR\u2026`);
              break;
            case 'analyze_progress':
              setStages((s) => ({
                ...s,
                analyze: { status: 'active', completed: event.completed, total: event.total },
              }));
              pushLog(
                event.failed ? 'error' : 'success',
                `${event.failed ? 'Failed to analyze' : 'Analyzed'} "${event.procedureName}" ` +
                  `(${secs(event.durationMs)}) \u2014 ${event.completed}/${event.total}`,
              );
              break;
            case 'analyze_complete':
              setStages((s) => ({
                ...s,
                analyze: { ...s.analyze, status: 'complete', completed: s.analyze.total },
              }));
              pushLog('success', `Analysis complete (${secs(event.totalMs)})`);
              pastAnalyze = true;
              break;
            case 'sop_started':
              setStages((s) => ({
                ...s,
                sop: { status: 'active', completed: 0, total: event.total },
              }));
              pushLog(
                'info',
                `Grouped into ${event.total} business process${event.total === 1 ? '' : 'es'}; generating consolidated SOPs\u2026`,
              );
              break;
            case 'sop_progress':
              setStages((s) => ({
                ...s,
                sop: { status: 'active', completed: event.completed, total: event.total },
              }));
              pushLog(
                event.failed ? 'error' : 'success',
                `${event.failed ? 'SOP failed for' : 'SOP ready for'} "${event.entryName}" ` +
                  `(${secs(event.durationMs)}) \u2014 ${event.completed}/${event.total}`,
              );
              break;
            case 'sop_complete':
              setStages((s) => ({
                ...s,
                sop: { ...s.sop, status: 'complete', completed: s.sop.total },
              }));
              pushLog('success', `SOP generation complete (${secs(event.totalMs)})`);
              break;
            case 'done': {
              terminal = true;
              setResult(event.finalResult);
              setPhase('done');
              const cost =
                event.finalResult.analysis.tokenUsage.totalCostUsd +
                event.finalResult.sop.tokenUsage.totalCostUsd;
              pushLog('success', `Migration complete \u00b7 $${cost.toFixed(4)}`);
              break;
            }
            case 'error':
              terminal = true;
              setError({ stage: event.stage, message: event.message });
              setStages((s) => ({ ...s, [event.stage]: { ...s[event.stage], status: 'error' } }));
              setPhase('error');
              pushLog('error', `Failed during ${stageLabel(event.stage)}: ${event.message}`);
              break;
          }
        }
        // Stream closed cleanly but we never saw a terminal event: the backend
        // likely outlived the connection. If we got past analyze, its result is
        // (or soon will be) persisted — switch to the polling state.
        if (!terminal) {
          if (pastAnalyze) {
            pushLog('muted', 'Live connection ended — polling for the saved result\u2026');
            setPhase('disconnected');
          } else {
            setError({ stage: 'analyze', message: 'The migration stream ended early.' });
            pushLog('error', 'The migration stream ended early.');
            setPhase('error');
          }
        }
      } catch {
        // Connection dropped mid-stream. After analyze the backend keeps running
        // to completion, so don't offer "Retry" (that double-bills) — poll for
        // the persisted result instead.
        if (pastAnalyze) {
          pushLog('muted', 'Live connection dropped — polling for the saved result\u2026');
          setPhase('disconnected');
        } else {
          setError({ stage: 'analyze', message: 'The migration stream was interrupted.' });
          pushLog('error', 'The migration stream was interrupted.');
          setPhase('error');
        }
      }
    },
    [id, pushLog],
  );

  // Fall back to a stored result when there's no in-memory file (e.g. refresh).
  // If the result isn't ready, check whether a run is still in progress on the
  // server (a record we persisted at extraction) and, if so, poll for it.
  const loadStored = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/migrate/${id}/result`);
      if (res.ok) {
        const stored = (await res.json()) as MigrationResult;
        setResult(stored);
        setStages(completedStages(stored));
        setLogs([]);
        setPhase('done');
        return;
      }

      const sres = await fetch(`/api/migrate/${id}/status`);
      if (sres.ok) {
        const { summary } = (await sres.json()) as {
          summary: { status: string; processCount: number };
        };
        if (summary.status === 'running') {
          // We can't replay granular progress, but show that it's underway.
          setStages({
            extract: { status: 'complete', completed: summary.processCount, total: summary.processCount },
            analyze: { status: 'active', completed: 0, total: summary.processCount },
            sop: { ...PENDING },
          });
          setLogs([]);
          pushLog(
            'muted',
            'This migration is still running on the server (started in another session) — polling for the result\u2026',
          );
          setPhase('disconnected');
          return;
        }
      }
      setPhase('missing');
    } catch {
      setPhase('missing');
    }
  }, [id, pushLog]);

  // Poll the persisted result; used while 'disconnected' (backend still running).
  const pollResult = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/migrate/${id}/result`);
      if (!res.ok) return false;
      const stored = (await res.json()) as MigrationResult;
      setResult(stored);
      setStages(completedStages(stored));
      pushLog('success', 'Saved result is ready.');
      setPhase('done');
      return true;
    } catch {
      return false;
    }
  }, [id, pushLog]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const file = takePendingUpload(id);
    if (file) {
      fileRef.current = file;
      void run(file);
    } else {
      void loadStored();
    }
  }, [id, run, loadStored]);

  // While disconnected, auto-check for the saved result every 15s.
  useEffect(() => {
    if (phase !== 'disconnected') return;
    const timer = setInterval(() => {
      void pollResult();
    }, 15_000);
    return () => clearInterval(timer);
  }, [phase, pollResult]);

  const retry = (): void => {
    if (fileRef.current) void run(fileRef.current);
  };

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-600 transition hover:text-neutral-900"
          >
            <ArrowLeft className="h-4 w-4" />
            New migration
          </Link>
          <span className="text-sm text-neutral-400">
            {result?.bundle.harFilename ?? 'Migration'}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {phase === 'missing' ? (
          <MissingState />
        ) : (
          <>
            <PipelineProgress
              extract={stages.extract}
              analyze={stages.analyze}
              sop={stages.sop}
            />

            {phase !== 'done' && logs.length > 0 && (
              <ActivityLog
                entries={logs}
                active={phase === 'running' || phase === 'disconnected'}
              />
            )}

            {phase === 'disconnected' && (
              <div className="mt-6 flex items-start justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
                <div className="flex items-start gap-3">
                  <Loader2 className="mt-0.5 h-5 w-5 flex-shrink-0 animate-spin text-amber-600" />
                  <div>
                    <p className="font-medium text-amber-800">
                      SOP generation is still running on the server
                    </p>
                    <p className="mt-0.5 text-sm text-amber-700">
                      The live connection dropped, but the job keeps going. Give it
                      ~2 minutes &mdash; we&rsquo;re auto-checking for the saved
                      result, or check now.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void pollResult()}
                  className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-amber-700"
                >
                  <RefreshCw className="h-4 w-4" />
                  Check for result
                </button>
              </div>
            )}

            {error && (
              <div className="mt-6 flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
                  <div>
                    <p className="font-medium text-red-800">
                      Failed during {stageLabel(error.stage)}
                    </p>
                    <p className="mt-0.5 text-sm text-red-700">{error.message}</p>
                  </div>
                </div>
                {fileRef.current ? (
                  <button
                    type="button"
                    onClick={retry}
                    className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Retry
                  </button>
                ) : (
                  <Link
                    href="/"
                    className="flex-shrink-0 rounded-lg border border-red-300 bg-white px-3.5 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50"
                  >
                    Start over
                  </Link>
                )}
              </div>
            )}

            {result && phase === 'done' && (
              <div className="mt-8">
                <BundleViewer result={result} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function stageLabel(stage: MigrationStage): string {
  if (stage === 'extract') return 'extraction';
  if (stage === 'analyze') return 'analysis';
  return 'SOP generation';
}

/** Format a millisecond duration as a compact seconds string. */
function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function MissingState(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white px-6 py-20 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
        <AlertTriangle className="h-6 w-6" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-neutral-900">
        This migration isn&rsquo;t available
      </h2>
      <p className="mt-1 max-w-md text-sm text-neutral-500">
        We couldn&rsquo;t find a saved result for this id. It may never have
        finished, or the local database was cleared. Upload the HAR again to
        re-run the migration.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Start a new migration
      </Link>
    </div>
  );
}
