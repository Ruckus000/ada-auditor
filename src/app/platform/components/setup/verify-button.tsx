'use client';

import { useState } from 'react';
import { NETWORK_ERROR_CODE, useErrorCode } from '../../lib/error-copy';
import { errorStyle } from '../../lib/field-styles';
import { describeRunFailure } from '../../lib/run-failure-copy';
import { inertWhen } from '../../lib/inert-button';
import { FONT, T } from '../../lib/tokens';

/**
 * Walk a journey's *stored* steps without auditing it. The preview route
 * spends the same run budget and hits the same policy checks a real run
 * does, but scans nothing and saves nothing — so an operator can see where a
 * path actually ends up while they are still shaping the steps, not only
 * after committing to the first scored audit.
 *
 * Two error surfaces, because the route answers two different kinds of "no":
 * a refusal before a browser ever launches (no target, no steps, the budget
 * is spent) carries an `error` code and nothing else, and is rendered as
 * `errorCode` the way every other form on this screen renders one. A walk
 * that launched and then failed partway carries `ok: false` plus whatever
 * evidence it captured, and is rendered as `outcome` — a result, not a
 * refusal, with its own panel rather than a one-line alert.
 */

/**
 * This form's own codes. The shared ones — `unauthorized`, `journey_not_found`,
 * the budget — come from `SHARED_ERROR_MESSAGES`; `invalid_journey_steps` is
 * overridden here because this button is about to *walk* those steps, not run
 * them.
 */
const MESSAGES: Record<string, string> = {
  journey_not_runnable: 'This journey has no target URL, so nothing can walk it.',
  journey_has_no_steps: 'Save at least one step first.',
  invalid_journey_steps: 'These stored steps are not ones a walk could follow.',
  action_not_allowed_here: 'One of these steps does something this journey’s environment does not allow.',
};

/** `statusCode` is absent when nothing measured it — never assumed 200. */
type PreviewPage = { url: string; title: string; statusCode?: number };

type PreviewScreenshot = { mimeType: string; base64: string };

type PreviewBody = {
  ok?: boolean;
  error?: string;
  detail?: string;
  pages?: PreviewPage[];
  truncatedPages?: number;
  screenshot?: PreviewScreenshot;
  screenshotOmitted?: boolean;
};

type Outcome =
  | {
      kind: 'ok';
      pages: PreviewPage[];
      truncatedPages: number;
      screenshot?: PreviewScreenshot;
      screenshotOmitted?: boolean;
    }
  | {
      kind: 'failed';
      error: string;
      detail?: string;
      pages: PreviewPage[];
      truncatedPages: number;
      screenshot?: PreviewScreenshot;
      screenshotOmitted?: boolean;
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
  const { errorMessage, setErrorCode, clearError } = useErrorCode(
    MESSAGES,
    () => 'That did not verify. Try again.',
  );

  async function verify() {
    if (busy) return;
    setBusy(true);
    clearError();
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
          screenshot: body.screenshot,
          screenshotOmitted: body.screenshotOmitted,
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
          screenshot: body.screenshot,
          screenshotOmitted: body.screenshotOmitted,
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
  /**
   * What the live region says once the walk is over — either outcome.
   *
   * It used to say `successSentence`, which is `''` for a failure: a screen
   * reader heard "Walking the path in a real browser…" and then the region
   * emptied, while the panel below reported the failure to everyone else. The
   * panel is a plain `div`, neither focused nor live, so nothing announced it.
   * In an accessibility-auditing product that is the defect class the tool
   * itself reports.
   */
  const outcomeSentence =
    outcome === null
      ? ''
      : outcome.kind === 'ok'
        ? successSentence
        : `The walk stopped before the end. ${outcome.detail ?? describeRunFailure(outcome.error)}`;

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
          {busy ? 'Walking the path in a real browser — usually under a minute.' : outcomeSentence}
        </span>
      </span>

      {errorMessage ? (
        <p role="alert" style={errorStyle}>
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

          {outcome.screenshot ? (
            // eslint-disable-next-line @next/next/no-img-element -- the bytes arrive inline as a data: URI; next/image optimizes fetched assets and has nothing to add to bytes already in memory
            <img
              src={`data:${outcome.screenshot.mimeType};base64,${outcome.screenshot.base64}`}
              alt={`Screenshot of the last page the walk reached${lastPage?.title ? `: ${lastPage.title}` : ''}`}
              style={{ maxWidth: '100%', borderRadius: 8, border: `1px solid ${T.rule}` }}
            />
          ) : outcome.screenshotOmitted ? (
            <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 12, color: T.inkMuted }}>
              The screenshot was too large to inline.
            </p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
