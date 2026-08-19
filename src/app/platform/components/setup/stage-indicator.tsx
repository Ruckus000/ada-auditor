import { FONT, T } from '../../lib/tokens';

/**
 * Where the operator is in onboarding. A list, not tabs: stages are earned by
 * the record, never clicked into. Hook-free on purpose — the server dispatcher
 * (Task 9) and the client stage-1 screen both render it.
 */
const STAGE_LABELS = ['Client', 'Site & path', 'First audit'] as const;

export function StageIndicator({ current }: { current: 0 | 1 | 2 }) {
  return (
    <nav aria-label="Setup progress">
      {/* `listStyle: none` strips the list semantics Safari/VoiceOver derive
          from the marker, so `role="list"` restores what the CSS took away. */}
      <ol
        role="list"
        style={{ display: 'flex', gap: 18, margin: 0, padding: 0, listStyle: 'none' }}
      >
        {STAGE_LABELS.map((label, index) => (
          <li
            key={label}
            aria-current={index === current ? 'step' : undefined}
            style={{
              fontFamily: FONT.sans,
              fontSize: 12.5,
              fontWeight: index === current ? 650 : 400,
              color: index === current ? T.accent : index < current ? T.inkSoft : T.inkMuted,
            }}
          >
            {index + 1}. {label}
            {index < current ? (
              <>
                <span aria-hidden="true"> ✓</span>
                <span className="ph-sr-only"> (complete)</span>
              </>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
