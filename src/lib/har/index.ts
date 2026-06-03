/**
 * HAR Extractor — public entry point (Phase 0.5).
 *
 * `extractAgentBundleFromHar` runs the full Section 4.2 algorithm:
 *   1. parse HAR JSON
 *   2. sanitize (MR-41, security-critical, runs first)
 *   3. extract procedures + listing + integrations (GraphQL responses)
 *   4. build the call graph (roots / leaves / cycles)
 *   5. naive book detection
 *   6. emit warnings (missing subprocess refs, cycles)
 *   7. assemble the ExtractedAgentBundle
 */

import { buildCallGraph } from './call-graph';
import { detectBooks } from './book-detector';
import { extractFromHar } from './extractor';
import { sanitizeHar } from './sanitizer';
import {
  EXTRACTION_WARNING_CODES,
  type ExtractedAgentBundle,
  type ExtractionWarning,
  type HarFile,
} from './types';

export const EXTRACTOR_VERSION = '0.5.0';

export type HarExtractionErrorCode =
  | 'INVALID_JSON'
  | 'NO_KOGNITOS_TRAFFIC'
  | 'NO_PROCESS_TEXT';

/** Thrown for the hard validation failures in spec Sections 3.3 / 7. */
export class HarExtractionError extends Error {
  readonly code: HarExtractionErrorCode;

  constructor(code: HarExtractionErrorCode, message: string) {
    super(message);
    this.name = 'HarExtractionError';
    this.code = code;
  }
}

export interface ExtractOptions {
  /** Original filename, recorded in `sourceMeta.harFilename`. */
  filename?: string;
}

function parseHarContent(harContent: string): HarFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(harContent);
  } catch {
    throw new HarExtractionError(
      'INVALID_JSON',
      "This doesn't look like a valid HAR file. Did you save the right export?",
    );
  }
  const root =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { log?: { entries?: unknown } })
      : null;
  if (!root || typeof root.log !== 'object' || root.log === null) {
    throw new HarExtractionError(
      'INVALID_JSON',
      "This doesn't look like a valid HAR file (missing 'log'). Did you save the right export?",
    );
  }
  return parsed as HarFile;
}

export async function extractAgentBundleFromHar(
  harContent: string,
  options: ExtractOptions = {},
): Promise<ExtractedAgentBundle> {
  const har = parseHarContent(harContent);

  // MR-41: sanitize before anything else touches the data.
  const { har: sanitized } = sanitizeHar(har);

  if (sanitized.log.entries.length === 0) {
    throw new HarExtractionError(
      'NO_KOGNITOS_TRAFFIC',
      'No Kognitos API traffic detected in this HAR. Was it captured while using v1 Kognitos?',
    );
  }

  const extraction = extractFromHar(sanitized);

  if (extraction.processes.length === 0) {
    throw new HarExtractionError(
      'NO_PROCESS_TEXT',
      'Found Kognitos traffic but no process source code. Did you click into each process before saving?',
    );
  }

  const callGraph = buildCallGraph(extraction.processes);
  const detectedBooks = detectBooks(extraction.processes);

  const warnings: ExtractionWarning[] = [...extraction.warnings];

  // MR-43: unresolved subprocess refs are warnings, not failures.
  const nameById = new Map(extraction.processes.map((p) => [p.id, p.name]));
  for (const proc of extraction.processes) {
    for (const ref of proc.subprocessRefs) {
      if (!ref.resolvableInBundle) {
        warnings.push({
          severity: 'warning',
          code: EXTRACTION_WARNING_CODES.MISSING_SUBPROCESS_IN_HAR,
          message: `"${proc.name}" calls "${ref.displayName}" but that process's source isn't in this HAR. Open it in v1 and recapture.`,
          context: {
            fromId: proc.id,
            targetId: ref.targetId,
            displayName: ref.displayName,
          },
        });
      }
    }
  }

  // MR-44: cycles need human review before topological migration.
  for (const cycle of callGraph.cycles) {
    warnings.push({
      severity: 'info',
      code: EXTRACTION_WARNING_CODES.CYCLE_DETECTED,
      message: `Recursive call chain detected: ${cycle
        .map((id) => nameById.get(id) ?? id)
        .join(' → ')}. Review ordering manually.`,
      context: { cycle },
    });
  }

  return {
    sourceMeta: {
      harFilename: options.filename ?? 'upload.har',
      extractedAt: new Date().toISOString(),
      extractorVersion: EXTRACTOR_VERSION,
      departmentId: extraction.departmentId,
    },
    processes: extraction.processes,
    callGraph,
    detectedBooks,
    warnings,
  };
}

export * from './types';
export { sanitizeHar, isKognitosUrl } from './sanitizer';
export { buildCallGraph, detectCycles } from './call-graph';
export { detectBooks, BOOK_HINTS } from './book-detector';
export { extractFromHar } from './extractor';
