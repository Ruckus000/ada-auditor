// Tests for failure-line.mjs, the blind corpus's own child-failure formatter.
//
// It exists as a separate copy because this directory may import only node:
// builtins and its siblings. That makes drift the risk, so these cases are the
// ones ../exec-failure.test.mjs asserts too — if the two stop agreeing, one of
// them is wrong.
//
// Usage: node --test failure-line.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { failureLine } from './failure-line.mjs';

test('reads a reason the child wrote to stdout — the jlink case', () => {
  assert.equal(
    failureLine({ stdout: 'Cannot run program "objcopy"', stderr: '' }),
    'Cannot run program "objcopy"',
  );
});

test('reads stderr when stdout is silent', () => {
  assert.equal(failureLine({ stdout: '', stderr: 'qpdf: damaged file' }), 'qpdf: damaged file');
});

test('reads Buffers, which is all execFileSync ever produces', () => {
  assert.equal(failureLine({ stdout: Buffer.from(''), stderr: Buffer.from('boom') }), 'boom');
});

test("prefer:'last' takes curl's final line, where it names the failure", () => {
  assert.equal(
    failureLine(
      { stdout: '', stderr: 'curl: trying again\ncurl: (22) 404' },
      { prefer: 'last' },
    ),
    'curl: (22) 404',
  );
});

test('never lets [object Object] outrank something the child said', () => {
  // The trap: String(error) on what execFileSync throws is '[object Object]',
  // and appending it to the stream lines makes it win under prefer:'last'.
  const summary = failureLine({ stdout: '', stderr: 'the real reason' }, { prefer: 'last' });
  assert.equal(summary, 'the real reason');
});

test('falls back to the message only when both streams are silent', () => {
  assert.equal(failureLine({ stdout: '', stderr: '', message: 'spawn curl ENOENT' }), 'spawn curl ENOENT');
});

test('is always one non-empty line, whatever it is handed', () => {
  for (const value of [undefined, null, {}, { stdout: '', stderr: '' }, 'bare']) {
    const line = failureLine(value);
    assert.equal(typeof line, 'string');
    assert.ok(line.length > 0);
    assert.ok(!line.includes('\n'));
  }
});
