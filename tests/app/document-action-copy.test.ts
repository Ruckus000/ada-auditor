import { describe, expect, it } from 'vitest';

import { describeDocumentRefusal } from '../../src/app/platform/lib/document-action-copy';

/**
 * What an operator reads when a document action does not deliver.
 *
 * The screen used to print the code — `repair_refused`, `content-changed`,
 * `document_toolchain_unavailable` — in a `role="alert"` paragraph. Every code
 * the three document routes can answer with gets one sentence and one next
 * step here, and this list is the routes' own: a code missing from it prints
 * raw, which is ugly and true, never a sentence invented for it.
 */

/** Every `error` the document routes and their shared cores can emit. */
const ROUTE_CODES = [
  'unauthorized',
  'client_not_found',
  'expected_json_body',
  'invalid_request_body',
  'expected_multipart_form_data',
  'missing_file_field',
  'document_too_large',
  'unsupported_document',
  'invalid_url',
  'unsafe_url',
  'fetch_failed',
  'redirected',
  'document_toolchain_unavailable',
  'converter_unavailable',
  'inspect_failed',
  'remediation_failed',
  'repair_failed',
  'repair_refused',
  'conversion_not_found',
  'artifact_not_stored',
];

describe('describeDocumentRefusal', () => {
  it('has a sentence for every code the routes emit, and never prints the code itself', () => {
    for (const code of ROUTE_CODES) {
      const copy = describeDocumentRefusal({ error: code });
      expect(copy, code).not.toContain(code);
      expect(copy, code).toMatch(/[.]$/);
      expect(copy, code).not.toMatch(/^The action stopped:/);
    }
  });

  it('prefers the route\'s own prose for a refusal, and adds the next step', () => {
    const copy = describeDocumentRefusal({
      error: 'repair_refused',
      detail: 'signed',
      message: 'this PDF carries a digital signature, and repairing it would invalidate that signature — convert the Word source it was exported from instead, or have the signer re-issue it once it is accessible',
    });
    expect(copy).toContain('digital signature');
    expect(copy).toContain('request');
  });

  it('distinguishes the repair that moved content from the stage that crashed', () => {
    expect(describeDocumentRefusal({ error: 'repair_failed', detail: 'content-changed' })).toMatch(
      /moved content|kept/i,
    );
    expect(describeDocumentRefusal({ error: 'repair_failed', detail: 'failed' })).toMatch(/stopped|damaged/i);
  });

  it('names the converter step that failed', () => {
    expect(
      describeDocumentRefusal({ error: 'remediation_failed', detail: 'converter-failed/source-to-fodt' }),
    ).toMatch(/LibreOffice/);
    expect(describeDocumentRefusal({ error: 'remediation_failed', detail: 'not-tagged' })).toMatch(
      /no structure|untagged/i,
    );
  });

  it('prints an unknown code rather than inventing a sentence for it', () => {
    expect(describeDocumentRefusal({ error: 'something_new' })).toBe('The action stopped: something_new.');
    // A missing code — a body that was not JSON — says so.
    expect(describeDocumentRefusal({ status: 502 })).toBe('The action stopped: http 502.');
  });

  it('does not walk the prototype for a hostile code', () => {
    expect(describeDocumentRefusal({ error: '__proto__' })).toBe('The action stopped: __proto__.');
  });
});
