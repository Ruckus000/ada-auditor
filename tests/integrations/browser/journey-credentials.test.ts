import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runJourney } from '../../../src/integrations/browser/journey-runner';

/**
 * A credential login, driven all the way through the browser.
 *
 * `resolveCredential` has unit tests and every `credentialRef` fixture in the
 * repo stops at the API, persistence or logger layer — **not one of them
 * reaches `runJourney`**. So the wiring between "a step names a secret" and "a
 * value is typed into the right box" was carried by nothing: transpose `user`
 * and `pass` at the call site and the entire suite stayed green, while every
 * real audit of a client's authenticated app silently failed its login and
 * reported a clean pass over their login page five times.
 *
 * That is the failure this whole plan exists for, and it was one line away.
 *
 * Reaching the dashboard *is* the transposition guard. The fixture only
 * navigates when both fields are right, so swapping them leaves the run on
 * `login.html` and the dashboard assertion fails.
 */

const FIXTURE_DIR = join(process.cwd(), 'fixtures/journey-app');

/** Must match `login.html`'s `VALID_USER` / `VALID_PASS`. */
const USER = 'auditor';
const SECRET = 'demo-pass';

/**
 * A password that appears nowhere in the fixture's source.
 *
 * `login.html` embeds its own valid password to check against, so the real one
 * is present in every capture of that page whether or not anything leaked.
 */
const SENTINEL = 'zzq-sentinel-not-in-fixture-9137';

/** The username half. A client's login identity is a credential too. */
const USER_SENTINEL = 'zzq-user-sentinel-not-in-fixture-4471';

const REF = 'fixturelogin';
const USER_KEY = `AUDIT_CREDENTIAL_${REF.toUpperCase()}_USER`;
const PASS_KEY = `AUDIT_CREDENTIAL_${REF.toUpperCase()}_PASS`;

let artifactsDir: string;

beforeAll(async () => {
  process.env[USER_KEY] = USER;
  process.env[PASS_KEY] = SECRET;
  artifactsDir = await mkdtemp(join(tmpdir(), 'ada-credentials-'));
});

afterAll(async () => {
  delete process.env[USER_KEY];
  delete process.env[PASS_KEY];
  await rm(artifactsDir, { recursive: true, force: true });
});

function loginSteps() {
  return [
    { action: 'navigate', type: 'goto' as const, path: 'login.html' },
    {
      action: 'login',
      type: 'fill' as const,
      selector: '#username',
      credentialRef: REF,
      field: 'user' as const,
    },
    {
      action: 'login',
      type: 'fill' as const,
      selector: '#password',
      credentialRef: REF,
      field: 'pass' as const,
    },
    { action: 'login', type: 'click' as const, selector: '#login-button' },
  ];
}

describe('runJourney, logging in with a stored credential', () => {
  it('resolves each field to the box it belongs in', async () => {
    const result = await runJourney({
      environment: 'test',
      journeyId: 'fixture-login',
      stepId: 'credential-login',
      fixtureDir: FIXTURE_DIR,
      artifactsDir,
      steps: loginSteps(),
    });

    // Two pages: the login, then the dashboard it navigated to. The second one
    // only exists if both credentials landed in the right field.
    const routes = result.pages.map((page) => page.page.route);
    expect(routes).toContain('/login.html');
    expect(routes).toContain('/dashboard.html');
  }, 60_000);

  /**
   * A resolved credential must not survive into stored evidence.
   *
   * This test had no teeth in its first two forms, and the second failure is
   * the interesting one.
   *
   * First it asserted the fixture's own password was absent — but `login.html`
   * embeds `demo-pass` in an inline script to validate against, so it matched
   * the fixture's source and failed for a reason that was not a leak.
   *
   * Then it used a sentinel and passed — but every page it looked at was
   * captured *before* anything had been typed. `capturePage` runs immediately
   * after `goto`, and the only later capture was the dashboard, where the
   * fields no longer exist. All four assertions were structurally incapable of
   * failing, which a review caught.
   *
   * `login-anchor.html` is what gives it teeth: filling the fields and then
   * clicking an in-page anchor changes `page.url()` without changing the
   * document, so the second capture is of a page whose inputs are filled. That
   * found a real leak — Chromium's AX tree carried the resolved **username**
   * verbatim into `*.ax.json`, which is uploaded to blob storage and served
   * back through the artifact route. The password escaped only because Blink
   * masks `input[type=password]`, which is not protection this product wrote.
   *
   * Both fields are asserted, deliberately. The username is a client's real
   * login identity, and the field that happens to be typed into a masked input
   * today is the field an OTP box or a "show password" toggle un-masks
   * tomorrow.
   *
   * Which assertion carries the weight, so nobody mistakes breadth for depth:
   * the **AX-tree** one. Remove the redaction and only that fails. The DOM
   * assertions still cannot fail for these two `input` fields, because `fill`
   * sets the property rather than the attribute — they are here to catch a
   * capture that starts serialising values, not because they are proving
   * anything today. (They would have teeth against a `contenteditable`, which
   * does keep its text in the markup; there is no such field in this fixture.)
   */
  it('keeps resolved credentials out of a page captured after they were typed', async () => {
    process.env[USER_KEY] = USER_SENTINEL;
    process.env[PASS_KEY] = SENTINEL;

    const result = await runJourney({
      environment: 'test',
      journeyId: 'fixture-login',
      stepId: 'credential-artifacts',
      fixtureDir: FIXTURE_DIR,
      artifactsDir,
      steps: [
        { action: 'navigate', type: 'goto', path: 'login-anchor.html' },
        {
          action: 'login',
          type: 'fill',
          selector: '#username',
          credentialRef: REF,
          field: 'user',
        },
        {
          action: 'login',
          type: 'fill',
          selector: '#password',
          credentialRef: REF,
          field: 'pass',
        },
        { action: 'navigate', type: 'click', selector: '#jump' },
      ],
    });

    // The point of the anchor: two captures of the same document, the second
    // taken with the fields filled. Without it this test proves nothing.
    expect(result.pages.length).toBe(2);

    for (const page of result.pages) {
      const { domSnapshotPath, axTreePath } = page.artifacts;
      expect(domSnapshotPath).toBeTruthy();
      expect(axTreePath).toBeTruthy();

      const dom = await readFile(domSnapshotPath as string, 'utf8');
      const axTree = await readFile(axTreePath as string, 'utf8');

      for (const secret of [SENTINEL, USER_SENTINEL]) {
        expect(dom).not.toContain(secret);
        expect(axTree).not.toContain(secret);

        // Also not in the in-memory copies, which are what the advisory pass
        // sends to a model and what platform detection reads.
        expect(page.html).not.toContain(secret);
        expect(JSON.stringify(page.axTree)).not.toContain(secret);
      }
    }
  }, 60_000);

  /**
   * The credential-store seam, driven through the same fixture login.
   *
   * `resolveCredentialFrom`'s ordering has unit tests; this is the half only a
   * browser can carry — that a value handed to the run in `credentials` is the
   * one typed into the box, ahead of an environment variable that disagrees.
   * The env vars are set to values the fixture rejects, so reaching the
   * dashboard is proof the map won: resolve from env instead and the run stays
   * on `login.html`.
   */
  it('types the stored credential ahead of the environment fallback', async () => {
    process.env[USER_KEY] = 'env-wrong-user';
    process.env[PASS_KEY] = 'env-wrong-pass';

    const result = await runJourney({
      environment: 'test',
      journeyId: 'fixture-login',
      stepId: 'credential-store-first',
      fixtureDir: FIXTURE_DIR,
      artifactsDir,
      steps: loginSteps(),
      credentials: { [REF]: { user: USER, pass: SECRET } },
    });

    expect(result.pages.map((page) => page.page.route)).toContain('/dashboard.html');
  }, 60_000);

  /**
   * A store-resolved value is a secret exactly like an env-resolved one.
   *
   * The redaction rides on `resolvedSecrets`, which is pushed at the moment of
   * resolution — before typing — whichever source answered. This is the case
   * that fails if the store path ever routes around that push. Same anchor
   * trick, same reasoning, as the env-fallback redaction case above; the
   * AX-tree assertion is the one with teeth there and it is the one with teeth
   * here.
   */
  it('keeps store-resolved credentials out of captured evidence', async () => {
    delete process.env[USER_KEY];
    delete process.env[PASS_KEY];

    const result = await runJourney({
      environment: 'test',
      journeyId: 'fixture-login',
      stepId: 'credential-store-artifacts',
      fixtureDir: FIXTURE_DIR,
      artifactsDir,
      steps: [
        { action: 'navigate', type: 'goto', path: 'login-anchor.html' },
        { action: 'login', type: 'fill', selector: '#username', credentialRef: REF, field: 'user' },
        { action: 'login', type: 'fill', selector: '#password', credentialRef: REF, field: 'pass' },
        { action: 'navigate', type: 'click', selector: '#jump' },
      ],
      credentials: { [REF]: { user: USER_SENTINEL, pass: SENTINEL } },
    });

    expect(result.pages.length).toBe(2);
    for (const page of result.pages) {
      const dom = await readFile(page.artifacts.domSnapshotPath as string, 'utf8');
      const axTree = await readFile(page.artifacts.axTreePath as string, 'utf8');

      for (const secret of [SENTINEL, USER_SENTINEL]) {
        expect(dom).not.toContain(secret);
        expect(axTree).not.toContain(secret);
        expect(page.html).not.toContain(secret);
        expect(JSON.stringify(page.axTree)).not.toContain(secret);
      }
    }
  }, 60_000);

  it('refuses a run whose credential is not configured, naming neither a value nor a guess', async () => {
    const run = runJourney({
      environment: 'test',
      journeyId: 'fixture-login',
      stepId: 'credential-missing',
      fixtureDir: FIXTURE_DIR,
      artifactsDir,
      steps: [
        { action: 'navigate', type: 'goto', path: 'login.html' },
        {
          action: 'login',
          type: 'fill',
          selector: '#username',
          credentialRef: 'notconfigured',
          field: 'user',
        },
      ],
    });

    await expect(run).rejects.toThrow(/notconfigured/);
    // The environment variable name is a map of what secrets exist. The error
    // names the reference and the field, and neither a value nor the key.
    await expect(run).rejects.not.toThrow(/AUDIT_CREDENTIAL/);
  }, 60_000);
});

afterEach(() => {
  // Restored between tests so one case cannot leave the credential unset for
  // the next and pass for the wrong reason.
  process.env[USER_KEY] = USER;
  process.env[PASS_KEY] = SECRET;
});
