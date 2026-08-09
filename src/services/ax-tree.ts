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
