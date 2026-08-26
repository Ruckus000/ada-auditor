/**
 * What a run's pages cost, read off the pages themselves.
 *
 * Spelled twice before this existed — once in `audit-run-handler.ts` and once
 * in `client-detail.ts` — and the two copies disagreed about the case that
 * matters. The handler reduced to `0`, so a run whose pages carried no
 * measurement reported "the slowest page took no time"; the screen returned
 * `null` and said nothing. Absent means not measured, which is the convention
 * every other timing field here follows, so that is the one that stayed.
 */

/**
 * The slowest page's wall clock, or null when no page carries a measurement.
 *
 * Takes the shape rather than a `StoredRunRecord` or a `StoredRunPage[]`: the
 * handler holds freshly built upload rows and the client screen holds rows read
 * back from the store, and this needs one field from each.
 */
export function slowestPageMs(
  pages: ReadonlyArray<{ durationMs?: number | null }> | undefined,
): number | null {
  const measured = (pages ?? [])
    .map((page) => page.durationMs)
    .filter((ms): ms is number => typeof ms === 'number');

  return measured.length > 0 ? Math.max(...measured) : null;
}

/**
 * What was left of the function when the run stopped.
 *
 * **A negative number is the most interesting thing this product can report**:
 * it is a run that outran the invocation it was given, which is the fact the
 * walk budget exists to prevent and the fact the page cap will be re-decided
 * from. It is therefore returned rather than clamped, and recorded on failures
 * as well as on successes — the failure path is where a run that ran out of
 * time actually ends up.
 */
export function headroomMs(ceilingMs: number, durationMs: number): number {
  return ceilingMs - durationMs;
}
