/**
 * `DELETE /api/migrations/[id]` — remove a persisted migration.
 *
 * Backs the delete button on the `/history` page. Idempotent: deleting an
 * unknown id is a no-op and still returns `200`. Reads/writes whichever
 * {@link MigrationStore} is configured (SQLite locally, Supabase in prod).
 *
 * Strict TS, no `any`.
 */

import { deleteResult } from '@/lib/migration/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  await deleteResult(id);
  return Response.json({ ok: true });
}
