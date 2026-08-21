'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { GLOSSARY, glossaryAnchorId, glossaryEntry, type GlossaryKey } from './glossary';
import { InfoTip } from './info-tip';
import { parseAuditResponse, type AuditResult } from './audit-types';
import { StatusRail, type ReadyState, type SystemStatus } from './status-rail';
import { RunForm, type PlatformHint, type RunConfig } from './run-form';
import { VerdictLegend, VerdictPanel } from './verdict-panel';
import { FindingsList, RunDetails } from './findings-list';
import { UnlockCard } from './unlock-card';
import { PRACTICE_SCENARIOS } from './practice-scenarios';

type AuthState = 'checking' | 'locked' | 'unlocked';

const RUN_STEPS = [
  'Starting a browser',
  'Walking through the journey',
  'Capturing evidence',
  'Applying the rules',
];

export function ControlPlane() {
  const [status, setStatus] = useState<SystemStatus>({
    state: 'loading',
    chaosEnabled: false,
    checkedAt: null,
    warnings: [],
  });

  const [config, setConfig] = useState<RunConfig>({
    environment: 'staging',
    runMode: 'browser',
    platformHint: 'auto',
    journeyId: 'demo-login',
    html: '<main><img src="hero.png" alt="Hero"></main>',
  });

  const [authState, setAuthState] = useState<AuthState>('checking');
  const [submitting, setSubmitting] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [copied, setCopied] = useState(false);
  const ledgerRef = useRef<HTMLDivElement>(null);

  const checkStatus = useCallback(async () => {
    setStatus((prev) => ({ ...prev, state: 'loading' }));

    try {
      const res = await fetch('/api/ready');
      const body = await res.json();
      const chaosEnabled = body?.checks?.chaosEnabled === true;
      const warnings: string[] = Array.isArray(body?.warnings)
        ? body.warnings.filter((warning: unknown): warning is string => typeof warning === 'string')
        : [];

      let state: ReadyState;
      if (res.ok && body?.status === 'ready') {
        state = 'ok';
      } else if (body?.checks?.auditorRunTokenConfigured === false) {
        state = 'needs-token';
      } else if (body?.checks?.runStoreConfigured === false) {
        // The server answered and is missing its database. Reporting this as
        // `unreachable` would send an operator to check whether the app is
        // running, which it is.
        state = 'needs-store';
      } else {
        state = 'unreachable';
      }

      setStatus({ state, chaosEnabled, checkedAt: Date.now(), warnings });
    } catch {
      setStatus({
        state: 'unreachable',
        chaosEnabled: false,
        checkedAt: Date.now(),
        warnings: [],
      });
    }
  }, []);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/console/session');
      const body = await res.json();
      setAuthState(body?.authenticated === true ? 'unlocked' : 'locked');
    } catch {
      // A failed request means we do not know, which is not the same as "no
      // session". Prompting for the token on a transient blip would train the
      // operator to re-paste a long-lived secret whenever the network hiccups,
      // so only an unauthenticated answer from the server locks the console.
      // StatusRail reports unreachability separately.
      setAuthState((previous) => (previous === 'checking' ? 'locked' : previous));
    }
  }, []);

  const lockConsole = useCallback(async () => {
    try {
      await fetch('/api/console/session', { method: 'DELETE' });
    } catch {
      // Even if the request fails, drop the UI back to locked.
    }
    setResult(null);
    setAuthState('locked');
  }, []);

  useEffect(() => {
    // The first check is scheduled rather than called in the effect body. Both
    // of these set state, and doing that synchronously from an effect cascades
    // a second render before the first has painted; neither has an answer to
    // show until its fetch returns anyway. Cleared on unmount with the
    // interval, so a console closed inside the first tick starts nothing.
    const first = setTimeout(() => {
      void checkStatus();
      void checkSession();
    }, 0);
    const id = setInterval(checkStatus, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [checkStatus, checkSession]);

  // Advance the progress list while a run is in flight. These are indicative
  // stages, not reports from the server — the API returns a single response at
  // the end — so the last stage stays put rather than claiming completion.
  useEffect(() => {
    if (!submitting) return;
    const id = setInterval(() => {
      setActiveStep((step) => Math.min(step + 1, RUN_STEPS.length - 1));
    }, 1200);
    return () => clearInterval(id);
  }, [submitting]);

  const runAudit = useCallback(
    async (chaosScenario?: string) => {
      setSubmitting(true);
      // Reset here rather than in the effect that ticks the list: the run
      // starting is this event, and an effect that reacted to it was setting
      // state a second time for something already known at the source.
      setActiveStep(0);
      setResult(null);
      setCopied(false);

      const simulated = chaosScenario != null;

      try {
        const body: Record<string, unknown> = {
          journeyId: config.journeyId,
          environment: config.environment,
        };

        if (chaosScenario) {
          body.chaosScenario = chaosScenario;
        } else if (config.runMode === 'browser') {
          body.browserMode = true;
        } else {
          body.html = config.html;
        }

        if (config.platformHint !== 'auto') {
          body.platformHint = config.platformHint;
        }

        const res = await fetch('/api/audit/console', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const payload = await res.json().catch(() => ({}));

        // The session expired or the server token rotated mid-visit: send the
        // operator back to the unlock screen rather than showing a bare error.
        if (res.status === 401 && payload?.error === 'console_session_required') {
          setAuthState('locked');
          setResult(null);
          return;
        }

        setResult(parseAuditResponse(payload, res.status, res.ok, simulated));
      } catch (err) {
        setResult({
          httpStatus: 0,
          ok: false,
          error: err instanceof Error ? err.message : undefined,
          findings: [],
          simulated,
        });
      } finally {
        setSubmitting(false);
      }
    },
    [config],
  );

  // Move focus to the result so keyboard and screen reader users are taken
  // straight to what they just asked for.
  useEffect(() => {
    if (result) ledgerRef.current?.focus();
  }, [result]);

  async function copyTrace() {
    if (!result?.requestId) return;
    try {
      await navigator.clipboard.writeText(result.requestId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied; the id is selectable on screen regardless.
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <p className="brand-name">ADA Auditor</p>
            <p className="brand-sub">
              Accessibility risk checks for web apps — not a legal certification.
            </p>
          </div>
        </div>
        <nav className="topbar-links" aria-label="Sections">
          {/* A route, so `next/link`: a bare anchor here reloads the whole
              app to reach a page the router already has. The glossary link
              below stays an anchor — it goes to a hash on this page. */}
          <Link className="skip-to-glossary" href="/">
            ← Portfolio
          </Link>
          <a className="skip-to-glossary" href="#glossary">
            Glossary
          </a>
        </nav>
      </header>

      <main className="workspace">
        {/* Left rail — everything you do */}
        <div className="console">
          <StatusRail status={status} onRefresh={checkStatus} />

          {authState === 'checking' && (
            <section className="console-card" aria-busy="true">
              <p className="console-sub">Checking whether this browser is unlocked…</p>
            </section>
          )}

          {authState === 'locked' && <UnlockCard onUnlocked={() => setAuthState('unlocked')} />}

          {authState === 'unlocked' && (
            <section className="console-card" aria-labelledby="run-heading">
              <h1 id="run-heading" className="console-title">
                Run an audit
              </h1>
              <p className="console-sub">
                Three steps. Every label has a{' '}
                <span className="inline-tip-demo" aria-hidden="true">
                  ?
                </span>{' '}
                you can hover, tab to, or click for a plain-English explanation.
              </p>

              <RunForm
                config={config}
                onChange={(patch) => setConfig((prev) => ({ ...prev, ...patch }))}
                onSubmit={() => runAudit()}
                submitting={submitting}
                readyState={status.state}
              />

              <p className="lock-row">
                <button type="button" className="ghost-btn" onClick={lockConsole}>
                  Lock console
                </button>
                <span className="lock-note">Unlocked on this browser for 30 days.</span>
              </p>
            </section>
          )}

          {authState === 'unlocked' && status.chaosEnabled && (
            <section className="console-card practice-card" aria-labelledby="practice-heading">
              <div className="console-subtitle">
                <h2 id="practice-heading">Practice mode</h2>
                <InfoTip termKey="chaosDemo" />
              </div>
              <p className="console-sub">
                Not sure what a verdict means? Run a simulation rigged to produce one. Nothing is
                really tested — these exist so you can see each outcome before it matters.
              </p>
              <div className="practice-buttons">
                {PRACTICE_SCENARIOS.map((item) => (
                  <button
                    key={item.scenario}
                    type="button"
                    className={`ghost-btn practice-${item.outcome}`}
                    disabled={submitting || status.state !== 'ok'}
                    onClick={() => runAudit(item.scenario)}
                  >
                    Show me {item.label}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right rail — everything you read */}
        <div
          className="ledger"
          ref={ledgerRef}
          tabIndex={-1}
          aria-label="Audit results"
          role="region"
        >
          {submitting ? (
            <section className="ledger-card running-card" aria-labelledby="running-heading">
              <h2 id="running-heading" className="ledger-title">
                Running…
              </h2>
              <ol className="run-steps">
                {RUN_STEPS.map((step, i) => (
                  <li
                    key={step}
                    className={
                      i < activeStep ? 'run-step is-done' : i === activeStep ? 'run-step is-active' : 'run-step'
                    }
                  >
                    <span className="run-step-mark" aria-hidden="true">
                      {i < activeStep ? '✓' : i === activeStep ? '●' : '○'}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
              <p className="sr-only" role="status" aria-live="polite">
                {RUN_STEPS[activeStep]}
              </p>
              <p className="running-note">
                A browser run takes a few seconds because a real browser is starting up.
              </p>
            </section>
          ) : result ? (
            <div className="result-stack">
              <VerdictPanel result={result} />
              {result.ok && <FindingsList result={result} />}
              <RunDetails result={result} onCopyTrace={copyTrace} copied={copied} />
              <details className="ledger-card outcomes-details">
                <summary>What the three outcomes mean</summary>
                <VerdictLegend current={result.verdict} />
              </details>
            </div>
          ) : (
            <section className="ledger-card empty-ledger" aria-labelledby="empty-heading">
              <h2 id="empty-heading" className="ledger-title">
                No run yet
              </h2>
              <p className="ledger-lede">
                Results appear here. Every audit ends in exactly one of three outcomes:
              </p>
              <VerdictLegend />
              <p className="ledger-note">
                Today the demo audits a built-in login → dashboard page, not a client site. Client
                sites are <strong>targets</strong> — nothing gets installed on them. You point this
                tool at their staging URL and it audits from here.
              </p>
            </section>
          )}
        </div>
      </main>

      <section className="glossary" id="glossary" aria-labelledby="glossary-heading">
        <h2 id="glossary-heading" className="glossary-title">
          Glossary
        </h2>
        <p className="glossary-lede">Every term this tool uses, in plain English.</p>
        <dl className="glossary-grid">
          {(Object.keys(GLOSSARY) as GlossaryKey[]).map((key) => {
            const entry = glossaryEntry(key);
            return (
              <div className="glossary-entry" key={key} id={glossaryAnchorId(key)}>
                <dt>{entry.term}</dt>
                <dd>
                  {entry.short}
                  {entry.detail && <span className="glossary-detail">{entry.detail}</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <footer className="footer">
        Evidence-first accessibility risk auditor. It finds risk; it does not certify legal
        compliance.
      </footer>
    </div>
  );
}
