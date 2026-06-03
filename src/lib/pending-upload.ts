/**
 * Tiny client-only handoff for the uploaded `File` between the home page and the
 * `/migration/[id]` page.
 *
 * A `File` can't ride along in a route param, so the home page stashes it here
 * keyed by the client-generated migration id, navigates, and the migration page
 * claims it to kick off the upload. If the entry is missing (e.g. a hard
 * refresh), the migration page falls back to `GET /api/migrate/[id]/result`.
 *
 * Module-singleton `Map`, lives only in the browser tab's memory.
 */

const pending = new Map<string, File>();

/** Stash the file to migrate under `id`. */
export function setPendingUpload(id: string, file: File): void {
  pending.set(id, file);
}

/** Claim (read + remove) the pending file for `id`, if any. */
export function takePendingUpload(id: string): File | undefined {
  const file = pending.get(id);
  if (file) pending.delete(id);
  return file;
}
