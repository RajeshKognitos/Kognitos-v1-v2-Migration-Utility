/**
 * `GET /api/migrations` — list all persisted migrations (newest first).
 *
 * Backs the `/history` page. Returns lightweight {@link MigrationSummary} rows
 * (no full payloads), read from whichever {@link MigrationStore} is configured.
 *
 * Strict TS, no `any`.
 */

import { listResults } from '@/lib/migration/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const migrations = await listResults();
  return Response.json({ migrations });
}
