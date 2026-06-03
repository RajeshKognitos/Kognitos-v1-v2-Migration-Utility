/**
 * `GET /api/migrate/[id]/result` — retrieve a completed migration result.
 *
 * Backs page refreshes on `/migration/[id]`: if the live SSE stream is no longer
 * available (e.g. the user reloaded), the page falls back to this endpoint. A
 * `404` means the id is unknown or the in-memory store was cleared by a restart.
 *
 * Strict TS, no `any`.
 */

import { getResult } from '@/lib/migration/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const result = await getResult(id);
  if (!result) {
    return Response.json(
      { error: 'No migration result found for this id. It may have expired.' },
      { status: 404 },
    );
  }
  return Response.json(result);
}
