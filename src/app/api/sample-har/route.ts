/**
 * `GET /api/sample-har` — serve the bundled sample HAR for the `/demo` flow.
 *
 * Lets first-timers run the pipeline without capturing their own HAR. Reads the
 * committed fixture from `samples/agent-bundles/` at request time (server-only).
 *
 * Strict TS, no `any`.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

const SAMPLE_RELATIVE = 'samples/agent-bundles/01-vendor-helpdesk.har';
export const SAMPLE_FILENAME = '01-vendor-helpdesk.har';

export async function GET(): Promise<Response> {
  try {
    const filePath = path.join(process.cwd(), SAMPLE_RELATIVE);
    const content = await readFile(filePath, 'utf8');
    return new Response(content, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${SAMPLE_FILENAME}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return Response.json(
      { error: 'Sample HAR is not available in this deployment.' },
      { status: 404 },
    );
  }
}
