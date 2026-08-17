import type { ClientDetail } from '../../../../services/client-detail';
import type { JourneyStepView } from '../../../../domain/journey-step';
import { describeRunFailure } from '../../lib/run-failure-copy';
import { FONT, T } from '../../lib/tokens';
import { VERDICT_CHIP } from '../../lib/verdict-chip';
import { Pill } from '../ui';
import { Empty } from './client-overview';
import { JourneySchedule } from './journey-schedule';
import { JourneyStepsEditor } from './journey-steps-editor';
import { RunJourneyButton } from './run-journey-button';

/**
 * The journeys recorded for one client, how each last fared, and the button
 * that runs one.
 *
 * Still a Server Component; the one interactive control is extracted as a
 * client child, the way the findings screen extracts `TriageControl`.
 *
 * This page used to say, in this comment, that it "reports, it does not yet
 * author" — because a stored journey was inert, and nothing anywhere read its
 * steps to build a run. That is no longer true: `POST /api/platform/clients/
 * <id>/journeys/<id>/runs` walks the stored journey, and `JourneyStepsEditor`
 * rewrites what it walks.
 *
 * *Creating* a journey is still API work — a new one needs a name and a target
 * URL, which PATCH does not accept — so the empty state below stays honest.
 */
export function ClientJourneys({ detail }: { detail: ClientDetail }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em' }}>
        Journeys
      </h2>

      {detail.journeys.length === 0 ? (
        <Empty
          title="No journeys yet"
          body="A journey is the path we re-walk on every run. POST one — its target URL and its steps, both — to /api/platform/clients/<id>/journeys with a bearer token and it appears here with a button to run it. There is no way to record one from these screens yet."
          action={null}
        />
      ) : (
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0 }}>
          {detail.journeys.map((journey) => {
            const badge = VERDICT_CHIP[journey.lastRun?.verdict ?? 'scan'];

            return (
              <li
                key={journey.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  flexWrap: 'wrap',
                  padding: '13px 16px',
                  borderRadius: 10,
                  border: `1px solid ${T.rule}`,
                  background: T.surface,
                  listStyle: 'none',
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <span style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 650 }}>
                    {journey.name}
                  </span>
                  <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}>
                    {journey.targetUrl ?? journey.id} ·{' '}
                    {journey.steps.length === 1 ? '1 step' : `${journey.steps.length} steps`}
                  </span>
                </span>

                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <JourneySchedule
                    clientId={detail.id}
                    journeyId={journey.id}
                    journeyName={journey.name}
                    schedule={journey.schedule}
                    runRefusal={journey.runRefusal}
                  />
                  <RunJourneyButton
                    clientId={detail.id}
                    journeyId={journey.id}
                    journeyName={journey.name}
                    runRefusal={journey.runRefusal}
                  />
                  {journey.lastRun ? (
                    <>
                      <Pill bg={badge.bg} color={badge.color} border={badge.border}>
                        {badge.label}
                      </Pill>
                      <span style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}>
                        {journey.lastRun.mustFix} must fix ·{' '}
                        {new Date(journey.lastRun.createdAt).toISOString().slice(0, 10)}
                      </span>
                    </>
                  ) : (
                    <span style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}>
                      Never run
                    </span>
                  )}

                </span>

                {/*
                  A direct child of the row, not of the right-hand group.
                  `flexBasis: 100%` inside that group did nothing useful: the
                  group is `nowrap`, so instead of breaking to its own line the
                  sentence became an oversized item that squeezed the verdict
                  pill and the date beside it. The `<li>` is the element that
                  wraps.
                */}
                {/*
                  What the journey actually does.

                  A direct child of the row for the same reason the "Stopped:"
                  line below is: the right-hand group is `nowrap`, so anything
                  placed inside it squeezes the controls instead of wrapping.
                */}
                <JourneyStepsEditor
                  clientId={detail.id}
                  journeyId={journey.id}
                  journeyName={journey.name}
                  environment={journey.environment}
                  steps={journey.steps}
                >
                  {/*
                    Passed as children rather than rebuilt inside the editor:
                    the list stays a Server Component, so the redaction that
                    keeps a stored literal off this screen keeps its own tests
                    and does not become something a client component decides.
                  */}
                  <StepList steps={journey.steps} />
                </JourneyStepsEditor>

                {journey.lastRun?.failureReason ? (
                  <span
                    style={{
                      flexBasis: '100%',
                      fontFamily: FONT.sans,
                      fontSize: 12.5,
                      color: T.inkMuted,
                    }}
                  >
                    <strong style={{ fontWeight: 650 }}>Stopped:</strong>{' '}
                    {describeRunFailure(journey.lastRun.failureReason)}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The steps, in order, in words.
 *
 * The screen showed a *count*. An operator could not tell whether a journey
 * logged in and reached a dashboard or fetched one page five times, which is
 * also why no static rule can be trusted to police what a step does:
 * `{action:'activate', type:'click', selector:'#delete-account'}` passes every
 * check in `authoredStepSchema`, and a person reading the list is the defence.
 *
 * A literal value is reported as present and never shown — see `toStepViews`.
 * An unrecognised step is called one rather than dressed up, because it cannot
 * run and the operator needs to know that before a schedule fires.
 */
/**
 * Where the step acts, in one phrase.
 *
 * Composed here rather than carried on the view. An `expect` declares up to
 * two things, and joining them into "url contains /x and #y visible" is a
 * sentence for reading — the editor next door needs the two values in their
 * own boxes, and un-writing that sentence to recover them is a parse that
 * breaks on the first path containing the word "and".
 */
function describeTarget(step: JourneyStepView): string {
  if (step.type === 'expect') {
    return [
      step.urlIncludes ? `url contains ${step.urlIncludes}` : undefined,
      step.selector ? `${step.selector} visible` : undefined,
    ]
      .filter(Boolean)
      .join(' and ');
  }

  return step.path ?? step.selector ?? '';
}

function StepList({ steps }: { steps: JourneyStepView[] }) {
  if (steps.length === 0) return null;

  return (
    <ol
      style={{
        flexBasis: '100%',
        margin: '2px 0 0',
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      {steps.map((step) => (
        <li
          key={step.position}
          style={{
            fontFamily: FONT.mono,
            fontSize: 11.5,
            color: step.recognised ? T.inkMuted : '#96231c',
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ minWidth: 16, textAlign: 'right' }}>{step.position}.</span>
          <span style={{ fontWeight: 650 }}>{step.type}</span>
          <span>{step.action}</span>
          {describeTarget(step) ? <span>{describeTarget(step)}</span> : null}
          {step.credentialRef ? (
            <span>
              credential {step.credentialRef} ({step.field})
            </span>
          ) : null}
          {step.hasLiteralValue ? (
            /*
              Named, not shown. A row written before `authoredStepSchema` can
              hold a real password, and moving one from a database column to a
              screen makes it more exposed rather than less. An operator seeing
              this on a login step knows to replace it with a credentialRef.
            */
            <span>types a literal value</span>
          ) : null}
          {step.recognised ? null : <span>· not a runnable step</span>}
        </li>
      ))}
    </ol>
  );
}
