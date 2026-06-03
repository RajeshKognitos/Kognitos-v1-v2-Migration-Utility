/**
 * `POST /api/migrate` — run the full HAR → bundle → IR → SOP pipeline and stream
 * progress to the browser as Server-Sent Events (Phase 3.5 MVP).
 *
 * The request is `multipart/form-data` with:
 *   - `file`: the `.har` upload
 *   - `id`:   a client-generated UUID (also the `/migration/[id]` route segment),
 *             used as the storage key so the result is retrievable on refresh.
 *
 * The response is a `text/event-stream`; each frame is one {@link MigrationEvent}.
 * The final `done` event carries the fully-serialized {@link MigrationResult},
 * which is also persisted via the migration store for `GET .../[id]/result`.
 *
 * Long-run hardening: a 15s heartbeat keeps idle proxies/browsers from killing
 * the connection, and writes are best-effort — if the client drops, the pipeline
 * still runs to completion and persists its result (retrievable on refresh).
 *
 * Strict TS, no `any`.
 */

import { randomUUID } from 'node:crypto';

import { analyzeBundle } from '@/lib/analyzer/orchestrator';
import { extractAgentBundleFromHar, HarExtractionError } from '@/lib/har';
import {
  deleteResult,
  saveResult,
  saveRunning,
  serializeMigrationResult,
} from '@/lib/migration/store';
import { generateBundleSops } from '@/lib/sop';
import type { MigrationEvent, MigrationStage } from '@/lib/sse-client';

// The pipeline calls OpenAI + node:crypto, so it must run on the Node runtime.
export const runtime = 'nodejs';
// 13-min ceiling: analyze (~6 min) + SOP generation for a multi-process bundle.
// Needs a Pro plan on Vercel; runs fine locally.
export const maxDuration = 800;
export const dynamic = 'force-dynamic';

const MAX_HAR_BYTES = 100 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { error: 'Expected multipart/form-data with a .har file.' },
      { status: 400 },
    );
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return Response.json(
      { error: 'No file uploaded. Attach a .har file under the "file" field.' },
      { status: 400 },
    );
  }
  if (file.size > MAX_HAR_BYTES) {
    return Response.json(
      { error: 'HAR file exceeds 100MB. Try capturing in smaller batches.' },
      { status: 413 },
    );
  }

  const id = stringField(formData, 'id') ?? randomUUID();
  const harContent = await file.text();
  const filename = file.name || 'upload.har';

  const encoder = new TextEncoder();

  // When the browser/proxy drops the connection, `enqueue` starts throwing. We
  // flip this flag and stop writing — but the pipeline keeps running so the
  // result is still persisted and retrievable via GET .../[id]/result.
  let clientGone = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let stage: MigrationStage = 'extract';

      // Best-effort write: never throws, so a dead connection can't abort the run.
      const send = (event: MigrationEvent): void => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          clientGone = true;
        }
      };

      // Heartbeat: an SSE comment (`: ping`, ignored by clients) every 15s keeps
      // idle proxies and the browser from killing the long-lived connection
      // during the slow analyze/SOP stages.
      const heartbeat = setInterval(() => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clientGone = true;
        }
      }, 15_000);

      let runningRecorded = false;
      try {
        // ── Stage 1: extract ────────────────────────────────────────────────
        send({ type: 'extract_started' });
        const bundle = await extractAgentBundleFromHar(harContent, { filename });
        const nameById = new Map(bundle.processes.map((p) => [p.id, p.name]));

        // Persist a "running" record now so the run is visible in /history and
        // resumable at /migration/[id] even if the connection drops mid-pipeline.
        await saveRunning({
          id,
          harFilename: filename,
          processCount: bundle.processes.length,
        });
        runningRecorded = true;

        send({
          type: 'extract_complete',
          processCount: bundle.processes.length,
          callGraph: bundle.callGraph,
          books: bundle.detectedBooks,
        });

        // ── Stage 2: analyze ────────────────────────────────────────────────
        stage = 'analyze';
        const analyzeTotal = bundle.processes.length;
        send({ type: 'analyze_started', total: analyzeTotal });
        let analyzeCompleted = 0;
        const analyzed = await analyzeBundle(bundle, {
          onProgress: (event) => {
            if (
              (event.type === 'process_complete' ||
                event.type === 'process_error') &&
              event.procedureId
            ) {
              analyzeCompleted += 1;
              send({
                type: 'analyze_progress',
                procedureId: event.procedureId,
                procedureName:
                  nameById.get(event.procedureId) ?? event.procedureId,
                durationMs: event.durationMs ?? 0,
                completed: analyzeCompleted,
                total: analyzeTotal,
                failed: event.type === 'process_error',
              });
            }
          },
        });
        send({
          type: 'analyze_complete',
          tokenUsage: analyzed.tokenUsage,
          totalMs: analyzed.timings.totalMs,
        });

        // ── Stage 3: SOPs ───────────────────────────────────────────────────
        stage = 'sop';
        const sopTotal = analyzed.irs.size;
        send({ type: 'sop_started', total: sopTotal });
        let sopCompleted = 0;
        const sopResult = await generateBundleSops(analyzed, {
          onProgress: (event) => {
            if (
              event.type === 'process_complete' ||
              event.type === 'process_error'
            ) {
              sopCompleted += 1;
              send({
                type: 'sop_progress',
                procedureId: event.procedureId,
                procedureName:
                  nameById.get(event.procedureId) ?? event.procedureId,
                durationMs: event.durationMs ?? 0,
                completed: sopCompleted,
                total: sopTotal,
                failed: event.type === 'process_error',
              });
            }
          },
        });
        send({
          type: 'sop_complete',
          tokenUsage: sopResult.tokenUsage,
          totalMs: sopResult.timings.totalMs,
        });

        // ── Done ────────────────────────────────────────────────────────────
        const finalResult = serializeMigrationResult(
          id,
          bundle,
          analyzed,
          sopResult,
        );
        await saveResult(finalResult);
        send({ type: 'done', id, finalResult });
      } catch (err) {
        const message =
          err instanceof HarExtractionError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Unexpected error while running the migration pipeline.';
        // Don't leave a ghost "running" row behind for a failed pipeline.
        if (runningRecorded) {
          try {
            await deleteResult(id);
          } catch {
            // Best-effort cleanup; ignore store errors here.
          }
        }
        send({ type: 'error', stage, message });
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed (client disconnected) — nothing to do.
        }
      }
    },
    // Client navigated away / aborted: stop writing, but let the pipeline finish
    // in the background so its result is persisted for a later GET.
    cancel() {
      clientGone = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** Read a single string field from form data, or `undefined`. */
function stringField(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
