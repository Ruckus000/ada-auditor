import Link from 'next/link';
import type { ClientDetail } from '../../../../services/client-detail';
import { FONT, T } from '../../lib/tokens';

/**
 * What we know about one client.
 *
 * A Server Component: it renders a record and has no state, so shipping it to
 * the browser would buy nothing. The prototype's version carried a trend
 * sparkline, a coverage ring, a "blocking issues" panel and a next-run time —
 * four panels with nothing behind them. What is left is the run, the journeys,
 * and an honest account of what has not happened yet.
 */
export function ClientOverview({ detail }: { detail: ClientDetail }) {
  const { lastRun } = detail;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em' }}>
        Overview
      </h2>

      {lastRun ? (
        <>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
              gap: 12,
              margin: 0,
            }}
          >
            <Stat label="Score" value={lastRun.score === null ? '—' : String(lastRun.score)} />
            <Stat label="Must fix" value={String(lastRun.mustFix)} tone={lastRun.mustFix > 0} />
            <Stat label="Should fix" value={String(lastRun.shouldFix)} />
            <Stat label="Pages audited" value={String(lastRun.pagesAudited)} />
          </dl>

          {lastRun.evidenceStatus !== 'complete' ? (
            // An incomplete run is not a lenient run. Saying so beside the
            // numbers is the difference between "this passed" and "we could
            // not see enough of it to say".
            <p
              style={{
                margin: 0,
                padding: '11px 14px',
                borderRadius: 9,
                background: T.surfaceSunk,
                border: `1px solid ${T.rule}`,
                fontFamily: FONT.sans,
                fontSize: 13,
                color: T.inkSoft,
              }}
            >
              Evidence for this run was <strong>{lastRun.evidenceStatus}</strong>, so the result is
              inconclusive rather than a pass or a fail. The counts below cover only what we could
              actually see.
            </p>
          ) : null}

          <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}>
            Last run {new Date(lastRun.createdAt).toISOString().slice(0, 10)} ·{' '}
            <span style={{ fontFamily: FONT.mono }}>{lastRun.requestId}</span>
            {/*
              Shown because the operator's real question about a journey is
              whether it still fits inside one function invocation. Omitted
              rather than zeroed on runs recorded before this was measured:
              "we did not measure" and "it was instant" are different claims.
            */}
            {lastRun.durationMs !== null ? (
              <>
                {' · took '}
                {Math.round(lastRun.durationMs / 1000)}s
                {lastRun.slowestPageMs !== null
                  ? `, slowest page ${(lastRun.slowestPageMs / 1000).toFixed(1)}s`
                  : ''}
              </>
            ) : null}
          </p>
        </>
      ) : (
        <Empty
          title={detail.journeys.length === 0 ? 'No journeys yet' : 'No runs yet'}
          body={
            detail.journeys.length === 0
              ? 'A journey is the path through their site we re-walk on every run — a checkout, a booking, a sign-in. Record one and this page fills in.'
              : 'The journeys are recorded. Nothing has been audited against them yet.'
          }
          action={
            detail.journeys.length === 0
              ? null
              : { href: `/clients/${detail.id}/journeys`, label: 'See the journeys' }
          }
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone = false }: { label: string; value: string; tone?: boolean }) {
  return (
    <div
      style={{
        padding: '13px 15px',
        borderRadius: 10,
        border: `1px solid ${T.rule}`,
        background: T.surface,
      }}
    >
      <dt style={{ fontFamily: FONT.sans, fontSize: 11.5, color: T.inkMuted, letterSpacing: '0.03em' }}>
        {label.toUpperCase()}
      </dt>
      <dd
        style={{
          margin: '4px 0 0',
          fontFamily: FONT.sans,
          fontSize: 24,
          fontWeight: 700,
          color: tone ? T.fail : T.ink,
        }}
      >
        {value}
      </dd>
    </div>
  );
}

export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: { href: string; label: string } | null;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 9,
        padding: '30px 26px',
        borderRadius: 12,
        border: `1px dashed ${T.ruleStrong}`,
        background: T.surface,
      }}
    >
      <span style={{ fontFamily: FONT.sans, fontSize: 16, fontWeight: 700 }}>{title}</span>
      <p
        style={{
          margin: 0,
          maxWidth: 480,
          fontFamily: FONT.sans,
          fontSize: 13.5,
          lineHeight: 1.55,
          color: T.inkSoft,
          textWrap: 'pretty',
        }}
      >
        {body}
      </p>
      {action ? (
        <Link
          href={action.href}
          style={{
            marginTop: 3,
            padding: '8px 15px',
            borderRadius: 9,
            background: T.accent,
            color: '#fff',
            fontFamily: FONT.sans,
            fontSize: 12.5,
            fontWeight: 650,
            textDecoration: 'none',
          }}
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
