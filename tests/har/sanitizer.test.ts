/**
 * Security-critical tests for the HAR sanitizer (MR-41).
 *
 * The real capture happens to contain no auth headers, so these tests INJECT
 * credentials into synthetic HARs and assert that NONE survive sanitization.
 * If any of these ever fail, treat it as a security incident.
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeHar,
  isKognitosUrl,
  STRIP_REQUEST_HEADERS,
  STRIP_RESPONSE_HEADERS,
  STRIP_QUERY_PARAMS,
} from '@/lib/har/sanitizer';
import type { HarEntry, HarFile } from '@/lib/har/types';

const SECRET = 'super-secret-token-DO-NOT-LEAK';

function entry(url: string, overrides: Partial<HarEntry> = {}): HarEntry {
  return {
    request: {
      method: 'POST',
      url,
      headers: [{ name: 'content-type', value: 'application/json' }],
      queryString: [],
      cookies: [],
      postData: { mimeType: 'application/json', text: '{}' },
    },
    response: {
      status: 200,
      headers: [{ name: 'content-type', value: 'application/json' }],
      cookies: [],
      content: { mimeType: 'application/json', text: '{}' },
    },
    ...overrides,
  };
}

/** A HAR with every credential channel populated on a Kognitos entry. */
function pollutedHar(): HarFile {
  const e = entry('https://api.app.kognitos.com/v1/graphql');
  e.request.headers = [
    { name: 'Authorization', value: `Bearer ${SECRET}` },
    { name: 'Cookie', value: `session=${SECRET}` },
    { name: 'X-Api-Key', value: SECRET },
    { name: 'X-Auth-Token', value: SECRET },
    { name: 'authorization', value: SECRET }, // lowercase duplicate
    { name: 'Content-Type', value: 'application/json' },
    { name: 'User-Agent', value: 'vitest' },
  ];
  e.request.queryString = [
    { name: 'token', value: SECRET },
    { name: 'access_token', value: SECRET },
    { name: 'api_key', value: SECRET },
    { name: 'ACCESS_TOKEN', value: SECRET }, // uppercase duplicate
    { name: 'operationName', value: 'procedureGroup' },
  ];
  e.request.cookies = [
    { name: 'session', value: SECRET },
    { name: 'refresh', value: SECRET },
  ];
  e.response.headers = [
    { name: 'Set-Cookie', value: `session=${SECRET}; HttpOnly` },
    { name: 'set-cookie', value: `refresh=${SECRET}` },
    { name: 'Content-Type', value: 'application/json' },
  ];
  e.response.cookies = [{ name: 'session', value: SECRET }];
  return { log: { entries: [e] } };
}

function allHeaderNames(har: HarFile): string[] {
  return har.log.entries.flatMap((e) => [
    ...e.request.headers.map((h) => h.name.toLowerCase()),
    ...e.response.headers.map((h) => h.name.toLowerCase()),
  ]);
}

function serialize(har: HarFile): string {
  return JSON.stringify(har);
}

describe('isKognitosUrl', () => {
  it('accepts kognitos.com and its subdomains', () => {
    expect(isKognitosUrl('https://kognitos.com/x')).toBe(true);
    expect(isKognitosUrl('https://api.app.kognitos.com/v1/graphql')).toBe(true);
    expect(isKognitosUrl('https://app.kognitos.com')).toBe(true);
  });

  it('rejects non-Kognitos and look-alike hosts (fail closed)', () => {
    expect(isKognitosUrl('https://events.launchdarkly.com')).toBe(false);
    expect(isKognitosUrl('https://o1339240.ingest.sentry.io')).toBe(false);
    // Look-alike: kognitos.com as a subdomain of an attacker host must fail.
    expect(isKognitosUrl('https://kognitos.com.evil.com/graphql')).toBe(false);
    expect(isKognitosUrl('https://notkognitos.com/graphql')).toBe(false);
    expect(isKognitosUrl('not a url')).toBe(false);
  });
});

describe('sanitizeHar — credential stripping (MR-41)', () => {
  it('removes every denylisted request header (case-insensitive)', () => {
    const { har } = sanitizeHar(pollutedHar());
    const names = har.log.entries[0].request.headers.map((h) =>
      h.name.toLowerCase(),
    );
    for (const banned of STRIP_REQUEST_HEADERS) {
      expect(names).not.toContain(banned);
    }
    // Benign headers survive.
    expect(names).toContain('content-type');
    expect(names).toContain('user-agent');
  });

  it('removes Set-Cookie response headers (case-insensitive)', () => {
    const { har } = sanitizeHar(pollutedHar());
    const names = har.log.entries[0].response.headers.map((h) =>
      h.name.toLowerCase(),
    );
    for (const banned of STRIP_RESPONSE_HEADERS) {
      expect(names).not.toContain(banned);
    }
    expect(names).toContain('content-type');
  });

  it('removes denylisted query params (case-insensitive)', () => {
    const { har } = sanitizeHar(pollutedHar());
    const names = har.log.entries[0].request.queryString.map((q) =>
      q.name.toLowerCase(),
    );
    for (const banned of STRIP_QUERY_PARAMS) {
      expect(names).not.toContain(banned);
    }
    expect(names).toContain('operationname');
  });

  it('clears structured request and response cookie arrays', () => {
    const { har } = sanitizeHar(pollutedHar());
    expect(har.log.entries[0].request.cookies).toEqual([]);
    expect(har.log.entries[0].response.cookies).toEqual([]);
  });

  it('GUARANTEE: the secret value does not appear anywhere in the output', () => {
    const { har } = sanitizeHar(pollutedHar());
    expect(serialize(har)).not.toContain(SECRET);
  });

  it('reports accurate stats', () => {
    const { stats } = sanitizeHar(pollutedHar());
    expect(stats.entriesIn).toBe(1);
    expect(stats.entriesKept).toBe(1);
    expect(stats.entriesDroppedNonKognitos).toBe(0);
    expect(stats.requestHeadersStripped).toBe(5); // 4 denylisted + 1 dup
    expect(stats.responseHeadersStripped).toBe(2);
    expect(stats.queryParamsStripped).toBe(4);
    expect(stats.cookiesCleared).toBe(3); // 2 request + 1 response
  });
});

describe('sanitizeHar — non-Kognitos host dropping (MR-41)', () => {
  it('drops non-Kognitos entries entirely, keeping only Kognitos traffic', () => {
    const har: HarFile = {
      log: {
        entries: [
          entry('https://api.app.kognitos.com/v1/graphql'),
          entry('https://events.launchdarkly.com/events'),
          entry('https://px.ads.linkedin.com/collect'),
          entry('https://www.google.com/ads'),
          entry('https://app.kognitos.com/assets/app.js'),
        ],
      },
    };
    const { har: out, stats } = sanitizeHar(har);
    expect(out.log.entries).toHaveLength(2);
    for (const e of out.log.entries) {
      expect(isKognitosUrl(e.request.url)).toBe(true);
    }
    expect(stats.entriesDroppedNonKognitos).toBe(3);
  });

  it('drops secrets carried on a non-Kognitos entry (whole entry removed)', () => {
    const evil = entry('https://evil-analytics.com/track');
    evil.request.headers = [{ name: 'Authorization', value: SECRET }];
    const har: HarFile = {
      log: { entries: [entry('https://api.app.kognitos.com/v1/graphql'), evil] },
    };
    const { har: out } = sanitizeHar(har);
    expect(out.log.entries).toHaveLength(1);
    expect(serialize(out)).not.toContain(SECRET);
  });
});

describe('sanitizeHar — robustness', () => {
  it('tolerates malformed / partial entries without throwing', () => {
    const har = {
      log: {
        entries: [
          { request: { url: 'https://api.app.kognitos.com/graphql' } },
          { request: { url: 'https://kognitos.com/x', method: 'GET' } },
          {},
        ],
      },
    } as unknown as HarFile;
    expect(() => sanitizeHar(har)).not.toThrow();
  });

  it('tolerates an empty / missing entries array', () => {
    const { stats } = sanitizeHar({ log: { entries: [] } });
    expect(stats.entriesIn).toBe(0);
    expect(stats.entriesKept).toBe(0);
  });

  it('no banned header name survives across all kept entries', () => {
    const { har } = sanitizeHar(pollutedHar());
    const names = allHeaderNames(har);
    for (const banned of [...STRIP_REQUEST_HEADERS, ...STRIP_RESPONSE_HEADERS]) {
      expect(names).not.toContain(banned);
    }
  });
});
