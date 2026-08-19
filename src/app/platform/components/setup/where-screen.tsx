import { StageHeading } from './stage-heading';

/**
 * Stage 2: where do we audit? Placeholder — the URL field, the fast path and
 * the advanced environment arrive in Task 10. It renders its heading so the
 * dispatcher is walkable (and focus-correct) before the form exists.
 */
export function WhereScreen({ clientId }: { clientId: string }) {
  void clientId;

  return <StageHeading>Where do we audit?</StageHeading>;
}
