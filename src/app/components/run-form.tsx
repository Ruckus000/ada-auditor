'use client';

import { FieldLabel, InfoTip } from './info-tip';
import { GLOSSARY, type GlossaryKey } from './glossary';
import type { ReadyState } from './status-rail';

export type RunMode = 'browser' | 'html';
export type PlatformHint = 'auto' | 'react' | 'wordpress';

export interface RunConfig {
  environment: string;
  runMode: RunMode;
  platformHint: PlatformHint;
  journeyId: string;
  html: string;
}

const ENVIRONMENTS: Array<{ value: string; label: string; glossaryKey: GlossaryKey }> = [
  { value: 'staging', label: 'Staging — recommended', glossaryKey: 'envStaging' },
  { value: 'preview', label: 'Preview', glossaryKey: 'envPreview' },
  { value: 'test', label: 'Test', glossaryKey: 'envTest' },
  { value: 'production', label: 'Production — most restricted', glossaryKey: 'envProduction' },
];

const ENV_GLOSSARY: Record<string, GlossaryKey> = {
  staging: 'envStaging',
  preview: 'envPreview',
  test: 'envTest',
  production: 'envProduction',
};

/** Why the run button is disabled, phrased as something the operator can act on. */
function blockedReason(readyState: ReadyState, runMode: RunMode, html: string): string | null {
  if (readyState === 'needs-token') {
    return 'Waiting on the run token — see the setup steps above.';
  }
  if (readyState === 'unreachable') {
    return 'The auditor service is not responding.';
  }
  if (readyState === 'loading') {
    return 'Still checking whether the service is ready…';
  }
  if (runMode === 'html' && html.trim().length === 0) {
    return 'Paste some HTML first, or switch to the demo journey.';
  }
  return null;
}

export function RunForm({
  config,
  onChange,
  onSubmit,
  submitting,
  readyState,
}: {
  config: RunConfig;
  onChange: (patch: Partial<RunConfig>) => void;
  onSubmit: () => void;
  submitting: boolean;
  readyState: ReadyState;
}) {
  const blocked = blockedReason(readyState, config.runMode, config.html);
  const envEntry = GLOSSARY[ENV_GLOSSARY[config.environment] ?? 'envStaging'];

  return (
    <form
      className="run-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!blocked && !submitting) onSubmit();
      }}
    >
      {/* Steps use role="group" + aria-labelledby rather than fieldset/legend:
          the label text is then exactly the id'd span, so the step number and
          the info tip stay out of the group's accessible name. */}
      <section className="step" aria-labelledby="step1-label">
        <p className="step-legend">
          <span className="step-number" aria-hidden="true">
            1
          </span>
          <span id="step1-label">Where are you auditing?</span>
        </p>

        <div className="field">
          <FieldLabel htmlFor="environment" termKey="environment">
            Target environment
          </FieldLabel>
          <select
            id="environment"
            value={config.environment}
            onChange={(e) => onChange({ environment: e.target.value })}
          >
            {ENVIRONMENTS.map((env) => (
              <option key={env.value} value={env.value}>
                {env.label}
              </option>
            ))}
          </select>
          <p className="field-help">{envEntry.short}</p>
        </div>

        {config.environment === 'production' && (
          <p className="callout callout-warn" role="status">
            <strong>Heads up.</strong> Production only permits read-only actions, so journeys that
            need to submit a form will stop early and report inconclusive. Prefer staging unless you
            specifically need to test the live site.
          </p>
        )}
      </section>

      {/* Step 2 — what to audit */}
      <section className="step" aria-labelledby="step2-label">
        <p className="step-legend">
          <span className="step-number" aria-hidden="true">
            2
          </span>
          <span id="step2-label">What should it audit?</span>
          <InfoTip termKey="runMode" />
        </p>

        <div className="mode-toggle" role="group" aria-label="What should it audit?">
          <button
            type="button"
            className={config.runMode === 'browser' ? 'mode-btn is-active' : 'mode-btn'}
            aria-pressed={config.runMode === 'browser'}
            aria-label="Demo journey — real browser, full evidence"
            onClick={() => onChange({ runMode: 'browser' })}
          >
            <span className="mode-title">Demo journey</span>
            <span className="mode-sub">Real browser · full evidence</span>
          </button>
          <button
            type="button"
            className={config.runMode === 'html' ? 'mode-btn is-active' : 'mode-btn'}
            aria-pressed={config.runMode === 'html'}
            aria-label="Pasted HTML — quick check, no evidence"
            onClick={() => onChange({ runMode: 'html' })}
          >
            <span className="mode-title">Pasted HTML</span>
            <span className="mode-sub">Quick check · no evidence</span>
          </button>
        </div>

        <p className="field-help">
          {config.runMode === 'browser' ? GLOSSARY.browserMode.detail : GLOSSARY.htmlMode.detail}
        </p>

        {config.runMode === 'html' && (
          <div className="field">
            <FieldLabel htmlFor="html" termKey="htmlMode">
              HTML to check
            </FieldLabel>
            <textarea
              id="html"
              value={config.html}
              spellCheck={false}
              onChange={(e) => onChange({ html: e.target.value })}
            />
            <p className="field-help">
              Try removing <code>alt=&quot;Hero&quot;</code> from the image to see a failing run.
            </p>
          </div>
        )}
      </section>

      {/* Step 3 — run */}
      <section className="step" aria-labelledby="step3-label">
        <p className="step-legend">
          <span className="step-number" aria-hidden="true">
            3
          </span>
          <span id="step3-label">Run it</span>
        </p>

        <details className="advanced">
          <summary>Advanced settings</summary>

          <div className="field">
            <FieldLabel htmlFor="platformHint" termKey="platformHint">
              Platform
            </FieldLabel>
            <select
              id="platformHint"
              value={config.platformHint}
              onChange={(e) => onChange({ platformHint: e.target.value as PlatformHint })}
            >
              <option value="auto">Auto-detect</option>
              <option value="react">React</option>
              <option value="wordpress">WordPress</option>
            </select>
            <p className="field-help">{GLOSSARY.platformHint.short}</p>
          </div>

          <div className="field">
            <FieldLabel htmlFor="journeyId" termKey="journeyId">
              Journey ID
            </FieldLabel>
            <input
              id="journeyId"
              type="text"
              value={config.journeyId}
              onChange={(e) => onChange({ journeyId: e.target.value })}
            />
            <p className="field-help">
              Leave this as <code>demo-login</code> unless you have added your own journey.
            </p>
          </div>
        </details>

        <button className="submit-btn" type="submit" disabled={submitting || blocked !== null}>
          {submitting
            ? 'Running…'
            : config.runMode === 'browser'
              ? 'Run the demo audit'
              : 'Check this HTML'}
        </button>

        {blocked && (
          <p className="blocked-reason" role="status">
            <span aria-hidden="true">⊘</span> {blocked}
          </p>
        )}
      </section>
    </form>
  );
}
