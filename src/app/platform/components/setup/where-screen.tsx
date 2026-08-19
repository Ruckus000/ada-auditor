'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { inertWhen } from '../../lib/inert-button';
import { FONT, T } from '../../lib/tokens';
import { StageHeading } from './stage-heading';

/**
 * Stage 2: where do we audit? A URL, a fast path to a homepage audit, and the
 * door to a multi-page journey — carrying the same a11y corrections
 * `NewClientScreen` picked up in review: an inert (never `disabled`) submit
 * button, an error CODE resolved to prose only at render, and `aria-invalid`
 * tied to the one field an error can actually be about.
 */
const MESSAGES: Record<string, string> = {
  invalid_request_body: 'That does not look like a URL we can audit. Check it and try again.',
  unauthorized: 'Your session expired. Reload and sign in again.',
  inline_credential: 'A step carried a credential of its own. Use a stored credential by name instead.',
};

/** A network failure never reached the server, so it never got a server error code. */
const NETWORK_ERROR_CODE = 'network';
/** `normalizeUrl` rejected the input before any request went out — a code this form invents itself. */
const LOCAL_INVALID_URL = 'local_invalid_url';

type Mode = 'homepage' | 'journey';
type Environment = 'production' | 'preview' | 'staging';

/** `rosewooddental.com` is what people paste; a scheme is what `new URL` needs. */
function normalizeUrl(raw: string): URL | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim())
    ? raw.trim()
    : `https://${raw.trim()}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function WhereScreen({ clientId }: { clientId: string }) {
  const router = useRouter();
  const urlId = useId();
  const environmentId = useId();

  const [raw, setRaw] = useState('');
  const [mode, setMode] = useState<Mode>('homepage');
  const [environment, setEnvironment] = useState<Environment>('production');
  const [saving, setSaving] = useState(false);
  // The code, not the sentence: the sentence is derived at render, and only
  // a URL-shaped code gets to mark the URL field invalid (see below) — a
  // decision that is only possible to make from the code, not from prose
  // that has already forgotten which field it was about.
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const urlErrorActive = errorCode === LOCAL_INVALID_URL || errorCode === 'invalid_request_body';

  const errorMessage =
    errorCode === null
      ? null
      : errorCode === NETWORK_ERROR_CODE
        ? 'Could not reach the server. Check your connection and try again.'
        : errorCode === LOCAL_INVALID_URL
          ? 'That does not look like a URL we can audit. Check it and try again.'
          : (MESSAGES[errorCode] ?? 'Could not save that. Try again.');

  const blocked = saving || raw.trim() === '';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    // `inertWhen` keeps the button in the tab order rather than truly
    // `disabled`, so Enter typed into the URL field can still reach the
    // form's submit event directly. This is the guard `disabled` used to
    // provide.
    if (raw.trim() === '') return;

    const url = normalizeUrl(raw);
    if (!url) {
      setErrorCode(LOCAL_INVALID_URL);
      return;
    }

    setSaving(true);
    setErrorCode(null);

    // The fast path writes the one step it needs itself — the target URL's
    // own path, not "/", so a pasted /shop stays audited as /shop.
    const body =
      mode === 'homepage'
        ? {
            name: 'Homepage',
            targetUrl: url.toString(),
            environment,
            steps: [
              { action: 'navigate', type: 'goto', path: `${url.pathname}${url.search}` || '/' },
            ],
          }
        : { name: 'First journey', targetUrl: url.toString(), environment };

    try {
      const response = await fetch(`/api/platform/clients/${clientId}/journeys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
        setErrorCode(parsed?.error ?? `status_${response.status}`);
        setSaving(false);
        return;
      }

      // Not reset on success, same as `NewClientScreen`: the record this
      // write just changed is what the setup route derives the stage from,
      // so `router.refresh()` swaps this component out for whatever stage
      // that turns out to be. There is no later render of this one where
      // `saving` would need to be false again.
      router.refresh();
    } catch {
      setErrorCode(NETWORK_ERROR_CODE);
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StageHeading>Where do we audit?</StageHeading>
      <p
        style={{
          margin: 0,
          fontFamily: FONT.sans,
          fontSize: 13.5,
          color: T.inkSoft,
          maxWidth: 480,
          textWrap: 'pretty',
        }}
      >
        Every audit walks a recorded path through the client&rsquo;s site and reports what a real
        user would hit. Start with their homepage — you can record deeper paths after the first
        result.
      </p>

      <form
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 480 }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label htmlFor={urlId} style={labelStyle}>
            Their website
          </label>
          <input
            id={urlId}
            value={raw}
            placeholder="rosewooddental.com"
            inputMode="url"
            required
            onChange={(event) => setRaw(event.target.value)}
            aria-invalid={urlErrorActive ? true : undefined}
            aria-describedby={urlErrorActive && errorMessage ? `${urlId}-error` : undefined}
            style={urlInputStyle}
          />
        </span>

        <fieldset
          style={{
            margin: 0,
            padding: 0,
            border: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <legend style={{ ...labelStyle, padding: 0, marginBottom: 3 }}>
            What should the first audit cover?
          </legend>

          <label style={radioLabelStyle}>
            <input
              type="radio"
              name="mode"
              value="homepage"
              checked={mode === 'homepage'}
              onChange={() => setMode('homepage')}
            />
            Start with the homepage (recommended) — one page, audited now.
          </label>

          <label style={radioLabelStyle}>
            <input
              type="radio"
              name="mode"
              value="journey"
              checked={mode === 'journey'}
              onChange={() => setMode('journey')}
            />
            Record a multi-page journey — a checkout, a booking, a sign-in. You&rsquo;ll add the
            steps next.
          </label>
        </fieldset>

        <details>
          <summary style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted, cursor: 'pointer' }}>
            Advanced: where this journey runs
          </summary>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
            <label htmlFor={environmentId} style={labelStyle}>
              Environment
            </label>
            <select
              id={environmentId}
              value={environment}
              onChange={(event) => setEnvironment(event.target.value as Environment)}
              style={inputStyle}
            >
              <option value="production">Production (read-only, the default)</option>
              <option value="preview">Preview</option>
              <option value="staging">Staging</option>
            </select>
          </span>
        </details>

        {errorMessage ? (
          <p id={`${urlId}-error`} role="alert" style={errorStyle}>
            {errorMessage}
          </p>
        ) : null}

        <span>
          <button
            type="submit"
            {...inertWhen(blocked, () => {})}
            className="ph-primary"
            style={{
              padding: '9px 18px',
              border: 'none',
              borderRadius: 9,
              background: T.accent,
              color: '#fff',
              fontFamily: FONT.sans,
              fontSize: 12.5,
              fontWeight: 650,
              opacity: blocked ? 0.55 : 1,
              cursor: blocked ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Continue'}
          </button>
        </span>
      </form>
    </div>
  );
}

const labelStyle = {
  fontFamily: FONT.sans,
  fontSize: 12,
  fontWeight: 650,
  color: T.inkSoft,
} as const;

const inputStyle = {
  padding: '9px 11px',
  borderRadius: 8,
  border: `1px solid ${T.rule}`,
  background: '#fff',
  fontFamily: FONT.sans,
  fontSize: 13.5,
  color: T.ink,
} as const;

const urlInputStyle = {
  ...inputStyle,
  fontFamily: FONT.mono,
  fontSize: 13,
} as const;

const radioLabelStyle = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  fontFamily: FONT.sans,
  fontSize: 13,
  color: T.inkSoft,
  cursor: 'pointer',
} as const;

const errorStyle = {
  margin: 0,
  padding: '9px 12px',
  borderRadius: 8,
  background: T.failWash,
  border: `1px solid ${T.failEdge}`,
  color: T.failDeep,
  fontFamily: FONT.sans,
  fontSize: 12.5,
} as const;
