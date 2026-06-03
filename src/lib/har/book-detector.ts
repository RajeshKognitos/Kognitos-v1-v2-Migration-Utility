/**
 * Naive book/integration detection (spec Section 4.4).
 *
 * A deliberately cheap first pass: lowercase each process's source and match it
 * against a dictionary of hint phrases. This only flags which integrations are
 * *likely* present so the UI can preview them; the Phase 1 parser does the
 * authoritative detection and mapping (06-book-integration-mapping.csv).
 */

import type { ExtractedProcess } from './types';

/**
 * Hint phrases per book. Matched case-insensitively as plain substrings.
 * Kept in sync with the spec's Section 4.4 starter list.
 */
export const BOOK_HINTS: Record<string, string[]> = {
  salesforce: ['salesforce', 'sfdc'],
  servicenow: ['servicenow', 'snow ticket', 'snow case'],
  email: ['send an email', 'send email'],
  outlook: ['outlook'],
  gmail: ['gmail'],
  slack: ['slack'],
  sap: ['from sap', 'in sap', 'sap material', 'sap order'],
  netsuite: ['netsuite'],
  sharepoint: ['sharepoint'],
  idp: [
    'ask koncierge',
    'extract data from',
    'extract the data from',
    'extract pages',
    'extract subdocuments',
  ],
  http: ['http get', 'http post', 'send http', 'http request'],
  s3: ['from s3', 'to s3', 'aws s3'],
  database: ['from the database', 'into the database', 'select from'],
  pdf: ['the pdf', 'as a pdf', 'merge pdf'],
  excel: ['the excel', 'worksheet', 'workbook'],
  sftp: ['sftp', 'from sftp', 'to sftp'],
  airtable: ['airtable'],
  zendesk: ['zendesk'],
  jira: ['jira'],
};

/**
 * Detect likely books across all processes. Returns a sorted, de-duplicated
 * list of book keys (the keys of `BOOK_HINTS`).
 */
export function detectBooks(processes: ExtractedProcess[]): string[] {
  const haystack = processes.map((p) => p.text.toLowerCase()).join('\n');
  const detected = new Set<string>();

  for (const [book, hints] of Object.entries(BOOK_HINTS)) {
    if (hints.some((hint) => haystack.includes(hint))) {
      detected.add(book);
    }
  }

  return [...detected].sort();
}
