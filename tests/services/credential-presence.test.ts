import { describe, expect, it } from 'vitest';
import { credentialsForSteps } from '../../src/services/credential-presence';

/**
 * Which credentials a journey needs, and whether they are configured.
 *
 * Presence, never a value. The one rule this must never break is that nothing
 * here can be made to say what a secret is — and the second is that it cannot
 * be made to answer about a variable outside the credential namespace, which
 * would turn `credentialRef` into a way to ask the server which of its own
 * secrets exist.
 */

const ENV = {
  AUDIT_CREDENTIAL_ACME_USER: 'auditor@acme.test',
  AUDIT_CREDENTIAL_ACME_PASS: 'hunter2',
  AUDIT_CREDENTIAL_HALF_USER: 'someone',
  AUDITOR_RUN_TOKEN: 'a-real-secret',
};

const login = (ref: string) => [
  { action: 'login', type: 'fill', selector: '#u', credentialRef: ref, field: 'user' },
  { action: 'login', type: 'fill', selector: '#p', credentialRef: ref, field: 'pass' },
];

describe('credentialsForSteps', () => {
  it('reports a configured credential once, not once per field', () => {
    // A login uses one reference for both fields. Listing it twice would read
    // as two credentials to configure.
    expect(credentialsForSteps(login('acme'), ENV)).toEqual([
      { ref: 'acme', user: true, pass: true },
    ]);
  });

  it('reports each half separately', () => {
    // The likely failure is somebody setting the pair and mistyping one
    // variable name, so "configured" for a half-set credential would be the
    // most misleading possible answer.
    expect(credentialsForSteps(login('half'), ENV)).toEqual([
      { ref: 'half', user: true, pass: false },
    ]);
  });

  it('reports one nobody has configured', () => {
    expect(credentialsForSteps(login('missing'), ENV)).toEqual([
      { ref: 'missing', user: false, pass: false },
    ]);
  });

  it('never carries a value', () => {
    // The assertion on the whole result, not one field of it.
    const json = JSON.stringify(credentialsForSteps(login('acme'), ENV));

    expect(json).not.toContain('hunter2');
    expect(json).not.toContain('auditor@acme.test');
  });

  /**
   * The reference becomes part of an environment variable name, so it decides
   * which variable is probed. Without the prefix and the pattern, a journey
   * naming the right thing would answer "is `AUDITOR_RUN_TOKEN` set?".
   */
  it('cannot be pointed at a variable outside the credential namespace', () => {
    const escapes = credentialsForSteps(
      [
        { action: 'login', type: 'fill', credentialRef: '../AUDITOR_RUN_TOKEN', field: 'user' },
        { action: 'login', type: 'fill', credentialRef: 'AUDITOR_RUN_TOKEN', field: 'user' },
      ],
      ENV,
    );

    // The first is not a reference at all and is skipped; the second is a
    // legal reference and simply names `AUDIT_CREDENTIAL_AUDITOR_RUN_TOKEN_USER`,
    // which nobody has set.
    expect(escapes).toEqual([{ ref: 'AUDITOR_RUN_TOKEN', user: false, pass: false }]);
  });

  it('treats an empty variable as unset, because the resolver does', () => {
    // `resolveCredential` refuses an empty string, so reporting it as
    // configured would promise something the run then refuses.
    expect(
      credentialsForSteps(login('blank'), { AUDIT_CREDENTIAL_BLANK_USER: '' }),
    ).toEqual([{ ref: 'blank', user: false, pass: false }]);
  });

  it('says nothing about a journey that names no credential', () => {
    expect(credentialsForSteps([{ action: 'navigate', type: 'goto', path: '/' }], ENV)).toEqual([]);
    expect(credentialsForSteps('not an array', ENV)).toEqual([]);
  });
});
