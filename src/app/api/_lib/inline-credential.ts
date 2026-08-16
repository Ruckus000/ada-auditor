/**
 * Rejects a step that carries a password rather than a reference to one.
 *
 * Reads the raw body rather than the parsed value, because it now runs *before*
 * the schema — a `.strict()` schema rejects these keys anyway, but as a generic
 * "invalid request body", and the specific answer is worth keeping.
 *
 * Still key names only, and still only the four. It never closed the hole it
 * was written for: a literal's value sits under the key `value`, so
 * `{action:'login', type:'fill', value:'hunter2'}` passed it. That one is
 * closed properly now, by `authoredStepSchema` refusing a `login` fill with a
 * literal — a rule about what the step *is*, not about what a key is called.
 */
export function containsInlineCredential(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const steps = (body as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return false;

  return steps.some(
    (step) =>
      Boolean(step) &&
      typeof step === 'object' &&
      Object.keys(step as Record<string, unknown>).some((key) =>
        /^(password|pass|secret|token)$/i.test(key),
      ),
  );
}
