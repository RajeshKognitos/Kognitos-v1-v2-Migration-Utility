/**
 * `GET /api/migrate/[id]/status` — lightweight lifecycle check for one run.
 *
 * Lets `/migration/[id]` distinguish "still running on the server" from "never
 * existed" on a fresh visit (when there's no live stream and no full result yet).
 * Returns the {@link MigrationSummary} (incl. `status`), or 404 if unknown.
 *
 * Strict TS, no `any`.
 */

import { getSummary } from '@/lib/migration/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const summary = await getSummary(id);
  if (!summary) {
    return Response.json({ error: 'Unknown migration id.' }, { status: 404 });
  }
  return Response.json({ summary });
}
