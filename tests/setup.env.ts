/**
 * Vitest setup: load `.env.local` into `process.env` so tests (notably the
 * gated OpenAI integration test) see the same env vars Next.js loads at runtime.
 * Vitest does not read `.env.local` on its own.
 *
 * Uses Node's built-in `process.loadEnvFile` (Node >= 20.12) — no dependency.
 * Existing env vars (e.g. ones passed inline on the command line) win, since
 * `loadEnvFile` does not overwrite already-set keys.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV_PATH = fileURLToPath(new URL('../.env.local', import.meta.url));

const loadEnvFile = (
  process as unknown as { loadEnvFile?: (path: string) => void }
).loadEnvFile;

if (loadEnvFile && existsSync(ENV_PATH)) {
  loadEnvFile(ENV_PATH);
}
