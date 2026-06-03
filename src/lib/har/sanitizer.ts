/**
 * HAR sanitizer — MR-41 (mandatory, runs first, security-critical).
 *
 * Strips every credential-bearing field from a HAR before ANY downstream
 * processing and drops all traffic to non-Kognitos hosts. Failure to sanitize
 * is treated as a security incident, so this module is intentionally
 * conservative: it removes by case-insensitive name match, also clears the
 * structured `cookies` arrays (not just the Cookie/Set-Cookie headers), and
 * fails-closed by dropping any entry whose host cannot be confirmed as
 * Kognitos.
 *
 * The sanitizer MUTATES and returns the provided HAR. Callers parse a fresh
 * object from JSON, so in-place mutation avoids cloning a ~15MB structure while
 * guaranteeing no un-sanitized copy lingers.
 */

import type { HarEntry, HarFile } from './types';

/** Request headers that must never survive sanitization. */
export const STRIP_REQUEST_HEADERS: readonly string[] = [
  'authorization',
  'cookie',
  'x-api-key',
  'x-auth-token',
];

/** Response headers that must never survive sanitization. */
export const STRIP_RESPONSE_HEADERS: readonly string[] = ['set-cookie'];

/** Query-string parameters that must never survive sanitization. */
export const STRIP_QUERY_PARAMS: readonly string[] = [
  'token',
  'access_token',
  'api_key',
];

/** Only hosts equal to or under this suffix are kept; everything else is dropped. */
export const KOGNITOS_HOST_SUFFIX = 'kognitos.com';

export interface SanitizationStats {
  entriesIn: number;
  entriesKept: number;
  /** Entries dropped because the host was not Kognitos (or unparseable). */
  entriesDroppedNonKognitos: number;
  requestHeadersStripped: number;
  responseHeadersStripped: number;
  queryParamsStripped: number;
  cookiesCleared: number;
}

export interface SanitizationResult {
  har: HarFile;
  stats: SanitizationStats;
}

/**
 * Returns true only when the URL's host is `kognitos.com` or a subdomain of it.
 * Fails closed: anything unparseable is treated as non-Kognitos and dropped.
 */
export function isKognitosUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === KOGNITOS_HOST_SUFFIX || host.endsWith(`.${KOGNITOS_HOST_SUFFIX}`);
}

/**
 * Sanitize a HAR in place per MR-41 and return it alongside stats describing
 * what was removed. Safe to call on a malformed/partial HAR — missing arrays
 * are tolerated.
 */
export function sanitizeHar(har: HarFile): SanitizationResult {
  const stats: SanitizationStats = {
    entriesIn: 0,
    entriesKept: 0,
    entriesDroppedNonKognitos: 0,
    requestHeadersStripped: 0,
    responseHeadersStripped: 0,
    queryParamsStripped: 0,
    cookiesCleared: 0,
  };

  const inputEntries: HarEntry[] = Array.isArray(har?.log?.entries)
    ? har.log.entries
    : [];
  stats.entriesIn = inputEntries.length;

  const reqHeaderDenylist = new Set(STRIP_REQUEST_HEADERS);
  const respHeaderDenylist = new Set(STRIP_RESPONSE_HEADERS);
  const queryDenylist = new Set(STRIP_QUERY_PARAMS);

  const kept: HarEntry[] = [];

  for (const entry of inputEntries) {
    // Drop non-Kognitos hosts entirely, before scrubbing — they never reach
    // storage so their credentials are gone too.
    if (!entry?.request?.url || !isKognitosUrl(entry.request.url)) {
      stats.entriesDroppedNonKognitos += 1;
      continue;
    }

    const { request, response } = entry;

    if (Array.isArray(request.headers)) {
      const before = request.headers.length;
      request.headers = request.headers.filter(
        (h) => !reqHeaderDenylist.has(h.name.toLowerCase()),
      );
      stats.requestHeadersStripped += before - request.headers.length;
    }

    if (Array.isArray(request.queryString)) {
      const before = request.queryString.length;
      request.queryString = request.queryString.filter(
        (q) => !queryDenylist.has(q.name.toLowerCase()),
      );
      stats.queryParamsStripped += before - request.queryString.length;
    }

    // Structured cookie arrays mirror the Cookie/Set-Cookie headers and also
    // contain secrets — clear them so nothing leaks through a side channel.
    if (Array.isArray(request.cookies) && request.cookies.length > 0) {
      stats.cookiesCleared += request.cookies.length;
      request.cookies = [];
    }

    if (response) {
      if (Array.isArray(response.headers)) {
        const before = response.headers.length;
        response.headers = response.headers.filter(
          (h) => !respHeaderDenylist.has(h.name.toLowerCase()),
        );
        stats.responseHeadersStripped += before - response.headers.length;
      }

      if (Array.isArray(response.cookies) && response.cookies.length > 0) {
        stats.cookiesCleared += response.cookies.length;
        response.cookies = [];
      }
    }

    kept.push(entry);
  }

  stats.entriesKept = kept.length;

  if (har.log) {
    har.log.entries = kept;
  }

  return { har, stats };
}
