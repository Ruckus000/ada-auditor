/**
 * Reduces a CDP accessibility tree to what an advisory pass can actually use.
 *
 * The full tree from `Accessibility.getFullAXTree` is megabytes on a real page
 * — every node, every property, plus DOM bookkeeping. Sending it verbatim to a
 * model would be slow and expensive for information that is almost entirely
 * noise. What matters for judging accessibility is the shape a screen reader
 * announces: role, accessible name, heading level, and the states that change
 * meaning.
 *
 * This also fixes an oddity in the original design: the tree was captured,
 * written to disk, and then never read by anything.
 */

export type AxNodeSummary = {
  role: string;
  name?: string;
  level?: number;
  states?: string[];
};

/** Properties that change what a control means when announced. */
const MEANINGFUL_STATES = new Set([
  'checked',
  'disabled',
  'expanded',
  'invalid',
  'pressed',
  'readonly',
  'required',
  'selected',
]);

/** Roles that carry no semantic weight on their own. */
const SKIPPED_ROLES = new Set(['none', 'presentation', 'generic', 'InlineTextBox', 'LineBreak']);

/**
 * Caps how much tree reaches the model. A long page can produce tens of
 * thousands of nodes; the first slice is the part a user encounters, and an
 * advisory judgement does not improve past this.
 */
const MAX_NODES = 400;

type RawAxValue = { value?: unknown } | undefined;

type RawAxNode = {
  ignored?: boolean;
  role?: RawAxValue;
  name?: RawAxValue;
  properties?: Array<{ name?: string; value?: RawAxValue }>;
};

function readValue(field: RawAxValue): string | undefined {
  if (!field || typeof field !== 'object' || !('value' in field)) {
    return undefined;
  }
  const value = field.value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

export function pruneAxTree(nodes: unknown): AxNodeSummary[] {
  if (!Array.isArray(nodes)) {
    return [];
  }

  const summaries: AxNodeSummary[] = [];

  for (const raw of nodes as RawAxNode[]) {
    if (summaries.length >= MAX_NODES) {
      break;
    }
    // Ignored nodes are not announced, so they cannot be the cause of an issue
    // a screen-reader user would hit.
    if (!raw || raw.ignored) {
      continue;
    }

    const role = readValue(raw.role);
    if (!role || SKIPPED_ROLES.has(role)) {
      continue;
    }

    const summary: AxNodeSummary = { role };

    const name = readValue(raw.name)?.trim();
    if (name) {
      summary.name = name.length > 200 ? `${name.slice(0, 200)}…` : name;
    }

    const states: string[] = [];
    for (const property of raw.properties ?? []) {
      if (!property?.name) continue;

      if (property.name === 'level') {
        const level = Number(readValue(property.value));
        if (Number.isFinite(level)) summary.level = level;
        continue;
      }

      if (MEANINGFUL_STATES.has(property.name)) {
        const value = readValue(property.value);
        // Skip the defaults — "not disabled" is not worth a token.
        if (value && value !== 'false') {
          states.push(value === 'true' ? property.name : `${property.name}=${value}`);
        }
      }
    }

    if (states.length > 0) {
      summary.states = states;
    }

    summaries.push(summary);
  }

  return summaries;
}

/** What replaces a resolved credential wherever one is found in evidence. */
export const REDACTED_SECRET = '[redacted credential]';

/**
 * Strips resolved credential values out of anything about to be stored.
 *
 * A journey names a secret and the runner resolves it server-side, which was
 * the whole point of `credentialRef` — the value never travels in a request
 * body and never lands in a stored journey. It then got typed into a page, and
 * the page got captured, and the capture got uploaded.
 *
 * Measured rather than supposed: a journey that fills a login and then clicks
 * an in-page anchor captures a *second* page at the new URL with the fields
 * still filled, and Chromium's `Accessibility.getFullAXTree` carries the value
 * of a text input verbatim — so the client's login identity was written into
 * `*.ax.json`, uploaded to blob storage and served back through the artifact
 * route. The password survived only because Blink masks `input[type=password]`
 * to bullets, which is protection this product neither wrote nor controls: an
 * OTP box, an API-key field, or a "show password" toggle that flips the type
 * puts the real secret in the same file.
 *
 * So the value is removed on the way out of the AX tree. Deep and value-based
 * rather than keyed on a field name —
 * `logger.ts` redacts by key because it knows its own shapes, and this walks a
 * structure defined by Chromium where the value can sit under `value`, `name`
 * or a property, and where a future version may add another.
 *
 * **Exact match, not `includes`, and that is a deliberate trade.** A resolved
 * credential lands in the tree as a node's whole value, which is what the
 * measurement above found, so equality is enough to remove it. Substring
 * matching would also catch a value the page composed into a longer string
 * ("Signed in as …") — and would redact every innocent string that happens to
 * contain the username. A client called `acme` with an operator account named
 * `acme` would have "acme" struck out of every label and URL in their own
 * report. Corrupting the evidence to hide a name the site is displaying
 * anyway is the worse of the two failures.
 *
 * So what this does not cover, plainly, and none of it is hand-waved — each
 * was measured against this repo's own Chromium:
 *
 *   - **The screenshot still shows it.** A text input displays its own value
 *     and `page.screenshot` captures what is displayed, so a username typed
 *     into a login form is legible in the PNG next to this file. Redaction
 *     cannot reach that; it would need the field masked before the shot, which
 *     paints over the very control the audit is judging for contrast and
 *     labelling. Left as it is, deliberately: a password renders as bullets
 *     because the browser masks it, and a username in the client's own report
 *     is a smaller thing than blinding the audit. Revisit the day a journey
 *     types a secret into a field the browser does not mask.
 *   - **A value split across nodes survives.** For an `input`, Chromium emits
 *     the value as one whole string and equality removes it. For a `textarea`
 *     or a `contenteditable`, it *also* emits per-line `StaticText` fragments
 *     at wrap boundaries — `"AAAA-"`, `"BBBB-"` — which are not exact matches,
 *     stay in the file, and concatenate back. This is Chromium's rendering of
 *     a value we typed, so it is squarely in scope and it is not covered.
 *     Judged low likelihood rather than harmless: `field` is `user | pass` and
 *     those go into `input` elements. The fix, when something needs it, is
 *     structural — drop the text descendants of an editable node — not a
 *     looser match, for the reason above.
 *   - **The DOM snapshot is not redacted.** For `input` and `textarea`, `fill`
 *     sets the property and not the attribute, so `page.content()` does not
 *     serialise it. That is *not* universal: a `contenteditable` keeps its text
 *     in the markup, and a framework that mirrors value into `defaultValue`
 *     puts it back in the attribute. A redactor was written for the snapshot
 *     and deleted because no test could make it fail — which, given this, says
 *     the missing thing was the test.
 *   - **A page that renders the credential into its own content** keeps it, per
 *     the exact-match trade above — at that point it is the site's text rather
 *     than a value we typed.
 *
 * One more, at the other end: the walk rewrites any string it matches, so a
 * credential that happened to equal `link`, `true` or `string` would rewrite a
 * structural field rather than a value. Improbable enough to accept and cheap
 * enough to say out loud.
 *
 * Empty and one-character secrets are skipped. A misconfigured credential
 * resolving to `""` would otherwise match every empty string in the tree.
 */
export function redactSecrets<T>(value: T, secrets: readonly string[]): T {
  const usable = secrets.filter((secret) => secret.length > 1);
  if (usable.length === 0) return value;

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      return usable.includes(node) ? REDACTED_SECRET : node;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([key, item]) => [key, walk(item)]),
      );
    }
    return node;
  };

  return walk(value) as T;
}
