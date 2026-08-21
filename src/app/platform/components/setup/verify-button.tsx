'use client';

import { useEffect, useState } from 'react';
import { describeRunFailure } from '../../lib/run-failure-copy';
import { inertWhen } from '../../lib/inert-button';
import { JOURNEY_STEPS_SAVED, journeyIdFromSavedEvent } from '../../lib/journey-events';
import { FONT, T } from '../../lib/tokens';

/**
 * Walk a journey's *stored* steps without auditing it. The preview route hits
 * the same policy checks a real run does, but scans nothing, saves nothing,
 * and spends the preview budget rather than the audits' — so an operator can
 * see where a path actually ends up while they are still shaping the steps,
 * without the loop costing a client their scheduled audit.
 *
 * It also runs itself. A successful save from the editor beside it triggers a
 * walk, so "save, then verify" is the flow rather than an instruction.
 *
 * Two error surfaces, because the route answers two different kinds of "no":
 * a refusal before a browser ever launches (no target, no steps, the budget
 * is spent) carries an `error` code and nothing else, and is rendered as
 * `errorCode` the way every other form on this screen renders one. A walk
 * that launched and then failed partway carries `ok: false` plus whatever
 * evidence it captured, and is rendered as `outcome` — a result, not a
 * refusal, with its own panel rather than a one-line alert.
 */

const MESSAGES: Record<string, string> = {
  journey_not_runnable: 'This journey has no target URL, so nothing can walk it.',
  journey_has_no_steps: 'Save at least one step first.',
  invalid_journey_steps: 'These stored steps are not ones a walk could follow.',
  run_budget_exceeded: 'The run budget for this window is used up. Try again later.',
  unauthorized: 'Your session expired. Reload and sign in again.',
  journey_not_found: 'That journey is no longer on this client.',
  action_not_allowed_here: 'One of these steps does something this journey’s environment does not allow.',
};

/** A network failure never reached the server, so it never got a server error code. */
const NETWORK_ERROR_CODE = 'network';

type PreviewScreenshot = { mimeType: string; base64: string };

/**
 * One page the walk reached, with the picture taken there.
 *
 * `statusCode` is absent when nothing measured it — never assumed 200.
 * `screenshot` is absent when none was captured, and `screenshotOmitted` says
 * one existed but the response could not afford it; the route fills its
 * budget from the last page backwards, so the omitted ones are the earliest.
 */
type PreviewPage = {
  url: string;
  title: string;
  statusCode?: number;
  screenshot?: PreviewScreenshot;
  screenshotOmitted?: boolean;
};

type PreviewBody = {
  ok?: boolean;
  error?: string;
  detail?: string;
  pages?: PreviewPage[];
  truncatedPages?: number;
};

type Outcome =
  | {
      kind: 'ok';
      pages: PreviewPage[];
      truncatedPages: number;
    }
  | {
      kind: 'failed';
      error: string;
      detail?: string;
      pages: PreviewPage[];
      truncatedPages: number;
    };

export function VerifyButton({
  clientId,
  journeyId,
  journeyName,
}: {
  clientId: string;
  journeyId: string;
  journeyName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // The code, not the sentence — see `where-screen.tsx`. Only set for a
  // pre-walk refusal; a walk that ran and failed is `outcome`, not this.
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const errorMessage =
    errorCode === null
      ? null
      : errorCode === NETWORK_ERROR_CODE
        ? 'Could not reach the server.'
        : (MESSAGES[errorCode] ?? 'That did not verify. Try again.');

  /**
   * Save, then verify — without the operator pressing this button.
   *
   * The stage's own copy already promises the sequence ("Save them, then
   * verify"), and until now the second half was a thing you had to remember.
   * The editor announces a successful save and this walks the path that was
   * just written, which is the loop authoring actually is: change a selector,
   * see where it lands, change it again.
   *
   * Kept as a listener rather than a call the editor makes directly because
   * the two are composed by server components in three stages and cannot share
   * a prop; `lib/journey-events` holds the contract. The id check is what
   * keeps a screen with two editors from verifying the wrong journey.
   *
   * `verify()` refuses to start while one is already running, so a burst of
   * saves cannot stack walks — the last one that arrives while idle wins, and
   * the budget only pays for what actually ran.
   */
  useEffect(() => {
    function onSaved(event: Event) {
      if (journeyIdFromSavedEvent(event) !== journeyId) return;
      // Called from an event, never during the effect: the React Compiler
      // rules this repo now enforces in CI refuse state set from an effect
      // body, and rightly — an effect that sets state on mount is a render
      // loop waiting to happen.
      void verify();
    }

    window.addEventListener(JOURNEY_STEPS_SAVED, onSaved);
    return () => window.removeEventListener(JOURNEY_STEPS_SAVED, onSaved);
    // `verify` is redeclared each render and closes over `busy`; re-subscribing
    // per render keeps the handler reading current state rather than the state
    // it was born with.
  });

  async function verify() {
    if (busy) return;
    setBusy(true);
    setErrorCode(null);
    setOutcome(null);

    try {
      const response = await fetch(
        `/api/platform/clients/${clientId}/journeys/${journeyId}/preview`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      );
      const body = (await response.json().catch(() => null)) as PreviewBody | null;

      if (body?.ok === true) {
        setOutcome({
          kind: 'ok',
          pages: body.pages ?? [],
          truncatedPages: body.truncatedPages ?? 0,
        });
      } else if (body?.ok === false) {
        // A walk that launched and then failed — `error` is always present
        // here, the route never answers `ok: false` without one.
        setOutcome({
          kind: 'failed',
          error: body.error ?? 'preview_failed',
          detail: body.detail,
          pages: body.pages ?? [],
          truncatedPages: body.truncatedPages ?? 0,
        });
      } else {
        // No `ok` at all: refused before a browser launched.
        setErrorCode(body?.error ?? `status_${response.status}`);
      }
    } catch {
      setErrorCode(NETWORK_ERROR_CODE);
    } finally {
      setBusy(false);
    }
  }

  const lastPage = outcome && outcome.pages.length > 0 ? outcome.pages[outcome.pages.length - 1] : undefined;
  const successSentence =
    outcome?.kind === 'ok'
      ? `The path works — walked ${outcome.pages.length} ${outcome.pages.length === 1 ? 'page' : 'pages'}, ended on “${lastPage?.title || 'an untitled page'}”.`
      : '';

  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          {...inertWhen(busy, verify)}
          aria-label={`Verify ${journeyName} so far`}
          style={{
            fontFamily: FONT.sans,
            fontSize: 12.5,
            fontWeight: 600,
            padding: '6px 12px',
            borderRadius: 8,
            border: `1px solid ${T.rule}`,
            background: busy ? T.surfaceSunk : T.surface,
            color: busy ? T.inkMuted : T.ink,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Walking the path…' : 'Verify so far'}
        </button>

        {/*
          Always mounted, text toggled — the long-wait announcement pattern
          `run-journey-button.tsx` uses. A screen reader has to already be
          watching this node when the text arrives, so it exists whether or
          not there is anything to say. Success is announced through this
          same region rather than a second one, so an operator does not have
          to be listening in two places to hear how a verify ended.
        */}
        <span role="status" style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}>
          {busy ? 'Walking the path in a real browser — usually under a minute.' : successSentence}
        </span>
      </span>

      {errorMessage ? (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: '9px 12px',
            borderRadius: 8,
            background: T.failWash,
            border: `1px solid ${T.failEdge}`,
            color: T.failDeep,
            fontFamily: FONT.sans,
            fontSize: 12.5,
          }}
        >
          {errorMessage}
        </p>
      ) : null}

      {outcome ? (
        <div
          style={{
            border: `1px solid ${outcome.kind === 'failed' ? T.failEdge : T.rule}`,
            background: T.surface,
            borderRadius: 10,
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxWidth: 480,
          }}
        >
          {outcome.kind === 'ok' ? (
            <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.ink }}>
              {successSentence}
            </p>
          ) : (
            <>
              <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.ink }}>
                The walk stopped before the end.
              </p>
              <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 12.5, color: T.inkSoft }}>
                {outcome.detail ?? describeRunFailure(outcome.error)}
              </p>
            </>
          )}

          {outcome.truncatedPages > 0 ? (
            <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 12, color: T.inkMuted }}>
              The walk was cut short:{' '}
              {outcome.truncatedPages === 1
                ? '1 more navigation was not followed.'
                : `${outcome.truncatedPages} more navigations were not followed.`}
            </p>
          ) : null}

          {/*
            One entry per page the walk reached, in the order it reached them,
            so the operator reads the path as a sequence rather than being
            handed only its destination. A walk that detoured through a consent
            wall and recovered used to look exactly like one that went straight
            there; now the detour is visible where it happened.

            An ordered list because the order is the content — `<ol>` says that
            to a screen reader, where a stack of images says nothing.
          */}
          {outcome.pages.length > 0 ? (
            <ol
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {outcome.pages.map((page, index) => (
                <li key={`${page.url}-${index}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontFamily: FONT.sans, fontSize: 12, color: T.inkMuted }}>
                    {index + 1}. {page.title || 'Untitled page'}
                    {page.statusCode ? ` · ${page.statusCode}` : ''}
                  </span>

                  {page.screenshot ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the bytes arrive inline as a data: URI; next/image optimizes fetched assets and has nothing to add to bytes already in memory
                    <img
                      src={`data:${page.screenshot.mimeType};base64,${page.screenshot.base64}`}
                      alt={`Screenshot of page ${index + 1} of ${outcome.pages.length}${
                        page.title ? `: ${page.title}` : ''
                      }`}
                      style={{ maxWidth: '100%', borderRadius: 8, border: `1px solid ${T.rule}` }}
                    />
                  ) : page.screenshotOmitted ? (
                    <span style={{ fontFamily: FONT.sans, fontSize: 12, color: T.inkMuted }}>
                      Screenshot too large to include in this response.
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
