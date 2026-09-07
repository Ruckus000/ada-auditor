// Tests for exec-failure.mjs, the spike's one child-failure formatter.
//
// The bug these exist for: every runner here reported a failed child as
// `(e.stderr?.toString() || String(e)).split('\n')[0]`, which discards a tool
// that printed its reason to stdout and truncates the rest to one line. The
// same defect cost a deploy cycle in scripts/run-command.ts (#212).
//
// Fixtures are the smallest object that reaches the branch under test — the
// shape execFileSync throws, not a real child.
//
// Usage: node --test exec-failure.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_CHARS,
  MAX_LINES,
  SUMMARY_CHARS,
  describeExecFailure,
  summariseExecFailure,
} from './exec-failure.mjs';

// --- describeExecFailure: both streams -------------------------------------

test('reports a failure the child wrote to stdout — the jlink case', () => {
  const detail = describeExecFailure({
    message: 'Command failed: java -cp … Finish in.pdf out.pdf',
    stdout: 'Error: java.io.IOException: Cannot run program "objcopy"',
    stderr: '',
  });

  assert.match(detail, /Cannot run program "objcopy"/);
  // The argv is what the reader already has; it must not crowd out the reason.
  assert.doesNotMatch(detail, /^Command failed/);
});

test('reports a failure the child wrote to stderr, unlabelled', () => {
  const detail = describeExecFailure({ stdout: '', stderr: 'Exception in thread "main"' });
  assert.equal(detail, 'Exception in thread "main"');
});

test('reports both streams when both spoke, stdout first and each labelled', () => {
  const detail = describeExecFailure({ stdout: 'partial report', stderr: 'boom' });

  assert.match(detail, /stdout:/);
  assert.match(detail, /stderr:/);
  assert.ok(detail.indexOf('stdout:') < detail.indexOf('stderr:'));
});

test('falls back to the message when neither stream spoke', () => {
  const detail = describeExecFailure({ stdout: '', stderr: '', message: 'spawn java ENOENT' });
  assert.equal(detail, 'spawn java ENOENT');
});

// --- the sync path: execFileSync hands back Buffers, not strings ------------

test('reads Buffer streams, which is all execFileSync ever produces', () => {
  const detail = describeExecFailure({
    stdout: Buffer.from('written to stdout'),
    stderr: Buffer.from(''),
  });

  assert.equal(detail, 'written to stdout');
});

test('a JSON.parse SyntaxError from a child that succeeded still reads sensibly', () => {
  // These runners parse the child's last stdout line inside the same try, so a
  // malformed report arrives at the same handler with no streams on it.
  let thrown;
  try {
    JSON.parse('not json');
  } catch (error) {
    thrown = error;
  }

  const detail = describeExecFailure(thrown);
  assert.match(detail, /JSON|Unexpected/i);
});

// --- never a second failure on the error path -------------------------------

test('survives an object whose stdout getter throws', () => {
  const hostile = {
    get stdout() {
      throw new Error('nope');
    },
    stderr: 'the real reason',
  };

  assert.equal(describeExecFailure(hostile), 'the real reason');
});

test('never returns empty and never throws, whatever it is handed', () => {
  for (const value of [undefined, null, '', 0, false, Symbol('s'), {}, []]) {
    const detail = describeExecFailure(value);
    assert.equal(typeof detail, 'string');
    assert.ok(detail.length > 0);
  }
});

// --- truncation -------------------------------------------------------------

test('keeps the head and the tail of a long stream', () => {
  const stdout = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
  const detail = describeExecFailure({ stdout, stderr: '' });

  assert.match(detail, /line 0/);
  assert.match(detail, /line 499/);
  assert.match(detail, /lines omitted/);
  assert.ok(detail.split('\n').length < MAX_LINES + 5);
});

test('cuts a single enormous line by characters, which a line budget cannot', () => {
  const detail = describeExecFailure({ stdout: 'x'.repeat(MAX_CHARS * 3), stderr: '' });
  assert.match(detail, /truncated at/);
  assert.ok(detail.length < MAX_CHARS * 2);
});

// --- summariseExecFailure ---------------------------------------------------

test('summarises to one line, drawn from stdout when that is where the reason is', () => {
  const summary = summariseExecFailure({
    stdout: 'Cannot run program "objcopy"\nmore detail',
    stderr: '',
  });

  assert.equal(summary, 'Cannot run program "objcopy"');
  assert.ok(!summary.includes('\n'));
});

test('summarises from stderr when stdout is silent', () => {
  const summary = summariseExecFailure({ stdout: '', stderr: 'qpdf: damaged file' });
  assert.equal(summary, 'qpdf: damaged file');
});

test("prefer:'last' takes the final line — curl names the failure last", () => {
  const summary = summariseExecFailure(
    { stdout: '', stderr: 'curl: trying again\ncurl: (22) The requested URL returned 404' },
    { prefer: 'last' },
  );

  assert.equal(summary, 'curl: (22) The requested URL returned 404');
});

test('caps a runaway line so a console table stays one row per document', () => {
  const summary = summariseExecFailure({ stdout: 'y'.repeat(SUMMARY_CHARS * 4), stderr: '' });
  assert.ok(summary.length <= SUMMARY_CHARS + 1);
  assert.ok(!summary.includes('\n'));
});

test('summary is never empty and never multi-line, whatever it is handed', () => {
  for (const value of [undefined, null, {}, { stdout: '', stderr: '' }, 'bare string']) {
    const summary = summariseExecFailure(value);
    assert.equal(typeof summary, 'string');
    assert.ok(summary.length > 0);
    assert.ok(!summary.includes('\n'));
  }
});
