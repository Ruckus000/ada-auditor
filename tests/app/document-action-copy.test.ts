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
  'document_budget_exceeded',
  'document_not_found',
  'invalid_answers',
  'invalid_document_id',
  'answers_too_large',
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

  it('passes on the budget refusal in the route\'s words, which say when it resets', () => {
    const copy = describeDocumentRefusal({
      error: 'document_budget_exceeded',
      detail: 'hour',
      message: 'Document work is capped at 500 per hour and this hour is spent. It resets in 12 minutes.',
    });
    expect(copy).toContain('12 minutes');
    // Without the route's sentence there is still a next step, not a code.
    expect(describeDocumentRefusal({ error: 'document_budget_exceeded', detail: 'day' })).toMatch(
      /capped|later/i,
    );
  });

  it('tells the two out-of-bounds parts apart from a malformed one', () => {
    // Three refusals a caller can only hear about if the sentence names which
    // part: the answers were too big, the answers were not answers, or the id
    // named no row of this client's.
    expect(describeDocumentRefusal({ error: 'answers_too_large', detail: 'limit is 2097152 bytes' })).toMatch(
      /descriptions|answers/i,
    );
    expect(describeDocumentRefusal({ error: 'invalid_answers', detail: 'not JSON' })).toMatch(/answers/i);
    expect(describeDocumentRefusal({ error: 'document_not_found' })).toMatch(/row|record|inventory/i);
  });

  it('prints an unknown code rather than inventing a sentence for it', () => {
    expect(describeDocumentRefusal({ error: 'something_new' })).toBe('The action stopped: something_new.');
    // A missing code — a body that was not JSON — says so.
    expect(describeDocumentRefusal({ status: 502 })).toBe('The action stopped: http 502.');
  });

  it('names the platform body cap when a 413 arrives with no code', () => {
    // The platform refuses a body over 4.5 MB before the route runs, so there
    // is no JSON and no code — only the status says what happened.
    expect(describeDocumentRefusal({ status: 413 })).toMatch(/4\.5 ?MB|larger than/i);
  });

  it('does not walk the prototype for a hostile code', () => {
    expect(describeDocumentRefusal({ error: '__proto__' })).toBe('The action stopped: __proto__.');
  });
});
