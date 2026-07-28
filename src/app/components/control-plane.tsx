'use client';

import { useCallback, useEffect, useState } from 'react';

type StatusState = 'loading' | 'ok' | 'warn' | 'bad';

interface HealthResponse {
  status: string;
  service: string;
  timestamp: string;
}

interface ReadyResponse {
  status: string;
  checks: {
    auditorRunTokenConfigured: boolean;
    chaosEnabled: boolean;
  };
  timestamp: string;
}

function dotClass(state: StatusState): string {
  return `status-dot ${state}`;
}

export function ControlPlane() {
  const [healthState, setHealthState] = useState<StatusState>('loading');
  const [readyState, setReadyState] = useState<StatusState>('loading');
  const [healthDetail, setHealthDetail] = useState('…');
  const [readyDetail, setReadyDetail] = useState('…');

  const [token, setToken] = useState('');
  const [journeyId, setJourneyId] = useState('demo-login');
  const [environment, setEnvironment] = useState('staging');
  const [html, setHtml] = useState('<main><img src="hero.png" alt="Hero"></main>');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchStatus = useCallback(async () => {
    setHealthState('loading');
    setReadyState('loading');

    try {
      const healthRes = await fetch('/api/health');
      const health: HealthResponse = await healthRes.json();
      const healthOk = healthRes.ok && health.status === 'ok';
      setHealthState(healthOk ? 'ok' : 'bad');
      setHealthDetail(healthOk ? 'live' : health.status);
    } catch {
      setHealthState('bad');
      setHealthDetail('unreachable');
    }

    try {
      const readyRes = await fetch('/api/ready');
      const ready: ReadyResponse = await readyRes.json();
      if (readyRes.ok && ready.status === 'ready') {
        setReadyState('ok');
        setReadyDetail('ready');
      } else if (ready.checks?.auditorRunTokenConfigured === false) {
        setReadyState('warn');
        setReadyDetail('token missing');
      } else {
        setReadyState('bad');
        setReadyDetail(ready.status);
      }
    } catch {
      setReadyState('bad');
      setReadyDetail('unreachable');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) {
      setResult({ ok: false, text: 'Run token is required.' });
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch('/api/audit/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          journeyId,
          environment,
          html,
        }),
      });

      const body = await res.json();
      const summary = [
        `HTTP ${res.status}`,
        body.requestId ? `requestId: ${body.requestId}` : null,
        body.ciStatus ? `ciStatus: ${body.ciStatus}` : null,
        body.evidenceStatus ? `evidence: ${body.evidenceStatus}` : null,
        body.error ? `error: ${body.error}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      setResult({ ok: res.ok, text: summary });
    } catch (err) {
      setResult({
        ok: false,
        text: err instanceof Error ? err.message : 'Request failed',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="shell">
      <div className="aurora" aria-hidden="true" />

      <section className="hero">
        <div>
          <div className="brand-mark">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M8 12h8M12 8v8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            ADA Auditor
          </div>

          <h1 className="headline">
            Evidence-first <em>accessibility risk</em> auditor
          </h1>

          <p className="lead">
            Hybrid deterministic checks and AI advisory for authenticated multi-step web
            apps. Surfaces WCAG risk signals with traceable evidence — not a legal
            certification authority.
          </p>

          <p className="disclaimer">
            <span aria-hidden="true">⚠</span>
            <span>
              This tool identifies accessibility <strong>risk</strong>. It does not
              certify ADA compliance or replace professional legal review.
            </span>
          </p>

          <ul className="pillars">
            <li>Incomplete evidence → inconclusive (never pass or fail)</li>
            <li>Deterministic findings gated on evidence completeness</li>
            <li>Platform hints override HTML heuristics</li>
          </ul>
        </div>

        <aside className="panel" aria-label="Control plane">
          <div className="status-strip">
            <div className="status-item">
              <span className={dotClass(healthState)} aria-hidden="true" />
              <span className="status-label">Health</span>
              <span className="status-value">{healthDetail}</span>
            </div>
            <div className="status-item">
              <span className={dotClass(readyState)} aria-hidden="true" />
              <span className="status-label">Ready</span>
              <span className="status-value">{readyDetail}</span>
            </div>
          </div>

          <div className="panel-body">
            <h2 className="panel-title">Run audit</h2>
            <p className="panel-sub">
              POST to <code>/api/audit/run</code> with your run token.
            </p>

            <form className="form-grid" onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="token">Run token</label>
                <input
                  id="token"
                  type="password"
                  autoComplete="off"
                  placeholder="Bearer token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="journeyId">Journey ID</label>
                  <input
                    id="journeyId"
                    type="text"
                    value={journeyId}
                    onChange={(e) => setJourneyId(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="environment">Environment</label>
                  <select
                    id="environment"
                    value={environment}
                    onChange={(e) => setEnvironment(e.target.value)}
                  >
                    <option value="production">production</option>
                    <option value="preview">preview</option>
                    <option value="staging">staging</option>
                    <option value="test">test</option>
                  </select>
                </div>
              </div>

              <div className="field">
                <label htmlFor="html">HTML snapshot</label>
                <textarea
                  id="html"
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                  spellCheck={false}
                />
              </div>

              <button className="submit-btn" type="submit" disabled={submitting}>
                {submitting ? 'Running…' : 'Run audit'}
              </button>
            </form>

            {result && (
              <div className={`result ${result.ok ? 'ok' : 'err'}`} role="status">
                {result.text}
              </div>
            )}
          </div>
        </aside>
      </section>

      <footer className="footer">
        ADA Auditor control plane · evidence over opinion
      </footer>
    </div>
  );
}
