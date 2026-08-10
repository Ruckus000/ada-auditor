import type { DeploymentConfig } from '../../../services/deployment-config';
import { FONT, T } from '../lib/tokens';

/**
 * What this deployment is configured to do.
 *
 * The screen this replaces had nine hundred lines of controls — scan
 * schedules, notification rules, WCAG level pickers, seats, SSO — none wired
 * to anything, most describing features that do not exist. Nothing here
 * schedules a run, sends a notification, or has a second user to give a seat
 * to.
 *
 * Read-only on purpose. These are deploy-time settings; a form that appeared
 * to change them from a web page would be lying about where the truth lives.
 * Each row says where its answer comes from and what the current state costs.
 */
export function SettingsScreen({ config }: { config: DeploymentConfig }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: '-0.015em' }}>
          Settings
        </h1>
        <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13, color: T.inkMuted }}>
          Configured where the app is deployed, not here. Change these with environment variables
          and redeploy.
        </p>
      </div>

      {config.degradedCount > 0 ? (
        <p
          role="status"
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
          {config.degradedCount === 1
            ? 'One setting below is running degraded.'
            : `${config.degradedCount} settings below are running degraded.`}{' '}
          None of them stops an audit; each one costs something, and the row says what.
        </p>
      ) : null}

      <dl style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: 0 }}>
        {config.settings.map((setting) => (
          <div
            key={setting.key}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '13px 16px',
              borderRadius: 10,
              border: `1px solid ${T.rule}`,
              borderLeft: setting.degraded ? `3px solid ${T.ruleStrong}` : `1px solid ${T.rule}`,
              background: setting.degraded ? T.surfaceSunk : T.surface,
            }}
          >
            {/* `dt` and `dd` sit directly inside this wrapper. A `<dl>` allows
                one `<div>` around each pair and no more — our own engine
                reported `dlitem` on all sixteen when they were a level deeper,
                which is the sort of thing that reads fine and navigates
                badly. */}
            <dt
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                flexWrap: 'wrap',
                fontFamily: FONT.sans,
                fontSize: 13.5,
                fontWeight: 650,
                color: T.ink,
              }}
            >
              {setting.label}
              <span
                style={{
                  fontFamily: FONT.mono,
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: setting.degraded ? T.failDeep : T.inkSoft,
                }}
              >
                {setting.value}
                {setting.degraded ? ' · degraded' : ''}
              </span>
            </dt>
            <dd
              style={{
                margin: 0,
                maxWidth: 640,
                fontFamily: FONT.sans,
                fontSize: 12.5,
                lineHeight: 1.55,
                color: T.inkMuted,
                textWrap: 'pretty',
              }}
            >
              {setting.detail}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
