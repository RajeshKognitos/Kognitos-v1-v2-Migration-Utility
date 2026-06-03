/**
 * Extractor integration test against the real (sanitized) HAR fixture.
 *
 * Fixture: samples/agent-bundles/01-vendor-helpdesk.har
 * Expected (from spec Section 10): 7 procedures, 3 roots, 5 leaves,
 * 100% of subprocess refs resolvable, no cycles.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, it, expect } from 'vitest';
import {
  extractAgentBundleFromHar,
  EXTRACTION_WARNING_CODES,
  type ExtractedAgentBundle,
} from '@/lib/har';

const FIXTURE = fileURLToPath(
  new URL('../../samples/agent-bundles/01-vendor-helpdesk.har', import.meta.url),
);

const DEPARTMENT_ID = 'a0jbrrmjasqluvr2qlnh0dsnw';

let bundle: ExtractedAgentBundle;

beforeAll(async () => {
  const har = readFileSync(FIXTURE, 'utf8');
  bundle = await extractAgentBundleFromHar(har, {
    filename: '01-vendor-helpdesk.har',
  });
});

describe('extractAgentBundleFromHar — vendor helpdesk fixture', () => {
  it('extracts exactly 7 processes', () => {
    expect(bundle.processes).toHaveLength(7);
  });

  it('captures the departmentId (= v1 agent ID, MR-46)', () => {
    expect(bundle.sourceMeta.departmentId).toBe(DEPARTMENT_ID);
    for (const p of bundle.processes) {
      expect(p.departmentId).toBe(DEPARTMENT_ID);
    }
  });

  it('resolves 100% of subprocess refs within the bundle', () => {
    const refs = bundle.processes.flatMap((p) => p.subprocessRefs);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((r) => r.resolvableInBundle)).toBe(true);

    const missing = bundle.warnings.filter(
      (w) => w.code === EXTRACTION_WARNING_CODES.MISSING_SUBPROCESS_IN_HAR,
    );
    expect(missing).toHaveLength(0);
  });

  it('builds a call graph with 3 roots and 5 leaves', () => {
    expect(bundle.callGraph.nodes).toHaveLength(7);
    expect(bundle.callGraph.roots).toHaveLength(3);
    expect(bundle.callGraph.leaves).toHaveLength(5);
    expect(bundle.callGraph.edges).toHaveLength(5);
  });

  it('has no cycles (the fixture is a DAG)', () => {
    expect(bundle.callGraph.cycles).toHaveLength(0);
  });

  it('identifies the expected entry-point root', () => {
    const rootNames = bundle.callGraph.roots.map(
      (id) => bundle.callGraph.nodes.find((n) => n.id === id)?.name,
    );
    expect(rootNames).toContain('to process vendorhelpdesk emails');
  });

  it('detects call types from surrounding syntax (invoke + run)', () => {
    const root = bundle.processes.find(
      (p) => p.name === 'to process vendorhelpdesk emails',
    );
    expect(root).toBeDefined();
    const callTypes = root!.subprocessRefs.map((r) => r.callType);
    expect(callTypes).toContain('invoke');
    expect(callTypes).toContain('run');

    const responder = bundle.processes.find(
      (p) => p.name === 'respond to vendorQuery2',
    );
    expect(responder!.subprocessRefs).toHaveLength(3);
    expect(responder!.subprocessRefs.every((r) => r.callType === 'run')).toBe(
      true,
    );
  });

  it('extracts schedules for the scheduled (published) process', () => {
    const scheduled = bundle.processes.find(
      (p) => p.name === 'Send processed ticket report',
    );
    expect(scheduled).toBeDefined();
    expect(scheduled!.stage).toBe('PUBLISHED');
    expect(scheduled!.schedules).toHaveLength(1);
    expect(scheduled!.schedules[0].expression).toBe('cron(20 18 * * ? *)');
    expect(scheduled!.schedules[0].enabled).toBe(true);
  });

  it('computes a sha256 source hash and line count per process', () => {
    for (const p of bundle.processes) {
      expect(p.sourceHash).toMatch(/^[0-9a-f]{64}$/);
      expect(p.lineCount).toBeGreaterThan(0);
      expect(p.text.length).toBeGreaterThan(0);
    }
  });

  it('detects ServiceNow and IDP books via the naive heuristic', () => {
    expect(bundle.detectedBooks).toContain('servicenow');
    expect(bundle.detectedBooks).toContain('idp');
  });

  it('warns about listed-but-uncaptured processes (MR-45)', () => {
    // The listing reports 9 procedures; only 7 had source captured.
    const missingText = bundle.warnings.filter(
      (w) => w.code === EXTRACTION_WARNING_CODES.MISSING_PROCESS_TEXT,
    );
    expect(missingText).toHaveLength(2);
  });

  it('records PUBLISHED-over-DRAFT preference once per process (MR-42)', () => {
    const stagePref = bundle.warnings.filter(
      (w) => w.code === EXTRACTION_WARNING_CODES.STAGE_PREFERENCE_PUBLISHED,
    );
    expect(stagePref).toHaveLength(7);
  });

  it('records extractor metadata', () => {
    expect(bundle.sourceMeta.harFilename).toBe('01-vendor-helpdesk.har');
    expect(bundle.sourceMeta.extractorVersion).toBe('0.5.0');
    expect(() => new Date(bundle.sourceMeta.extractedAt).toISOString()).not.toThrow();
  });
});
