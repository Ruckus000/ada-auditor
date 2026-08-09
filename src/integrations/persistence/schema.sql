-- ADA Auditor schema (Neon Postgres, provisioned through the Vercel Marketplace).
--
-- Designed AFTER multi-page scanning landed, deliberately: a run is a journey
-- and a journey is several pages, so `run_pages` is a first-class table and
-- every finding names the page it was found on. Designing this first would
-- have baked the single-page shape into the database and cost a migration plus
-- a rewrite of every screen that reads findings.
--
-- No tenancy and no RLS. There is one trusted operator group, not mutually
-- distrustful tenants — see the Phase 2 auth decision. If that ever changes,
-- it changes here first.
--
-- Idempotent: safe to re-run. `scripts/migrate.ts` applies it.

-- ---------------------------------------------------------------- clients --

create table if not exists clients (
  id          text primary key,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Per-client settings the Settings screen writes. One row per client, shape
-- kept open because the settings themselves are still moving.
create table if not exists client_config (
  client_id   text primary key references clients (id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- --------------------------------------------------------------- journeys --

-- `steps` is the JourneyStep[] the runner walks. JSONB rather than a table of
-- steps: they are read and written whole, never queried into, and a `fill`
-- step is one of two shapes. A credential is referenced here, never inlined —
-- the same rule that keeps secrets out of request bodies keeps them out of
-- this column.
create table if not exists journeys (
  id          text primary key,
  client_id   text references clients (id) on delete cascade,
  name        text not null,
  target_url  text,
  steps       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists journeys_client_idx on journeys (client_id);

-- ------------------------------------------------------------------- runs --

-- `request_id` is the primary key rather than a surrogate: it is the id the
-- API hands callers, the id a poll uses, and the id artifacts are filed under.
-- A separate serial would mean every lookup joins to find it.
create table if not exists runs (
  request_id       text primary key,
  journey_id       text not null,
  environment      text not null,
  platform         text not null,
  evidence_status  text not null,
  ci_status        text not null,
  status           text not null default 'running',
  failure_reason   text,
  duration_ms      integer not null default 0,
  browser_mode     boolean not null default false,
  -- Non-zero means the page cap stopped the run short of the journey's end.
  -- Persisted because a partial audit must never read as a complete one, and
  -- the log line that recorded it does not survive the invocation.
  truncated_pages  integer not null default 0,
  created_at       timestamptz not null default now()
);

-- Serves `getLatestRun` and `list` — both order by recency within a journey
-- and environment, which is otherwise a full scan.
create index if not exists runs_journey_env_created_idx
  on runs (journey_id, environment, created_at desc, request_id desc);

create index if not exists runs_created_idx on runs (created_at desc);

-- -------------------------------------------------------------- run_pages --

-- One row per page the journey walked through. `position` preserves visit
-- order, which the report and the console both render by; sorting by URL or
-- insertion id would scramble a journey into alphabetical order.
create table if not exists run_pages (
  request_id       text not null references runs (request_id) on delete cascade,
  position         integer not null,
  url              text not null,
  route            text not null,
  title            text not null,
  evidence_status  text not null,
  -- Durable artifact URLs (screenshot / DOM / AX tree) for THIS page.
  artifacts        jsonb not null default '{}'::jsonb,
  primary key (request_id, position)
);

-- --------------------------------------------------------------- findings --

-- `page_url` is nullable on purpose: advisory findings are produced once over
-- the whole journey, so attributing them to a page would be a claim we cannot
-- support. Deterministic findings always carry one.
--
-- `status` and `note` are triage state. A dismissal without a reason is how a
-- finding disappears with no record of why, so the UI requires the note; the
-- column stays nullable because `open` and `fixed` do not need one.
create table if not exists findings (
  id                 bigserial primary key,
  request_id         text not null references runs (request_id) on delete cascade,
  -- Preserves the order the engine emitted findings in, so a stored run
  -- round-trips to the same list it was reported as.
  position           integer not null,
  page_url           text,
  code               text not null,
  severity           text not null,
  source             text not null,
  message            text,
  -- Nullable, and deliberately without a default: an advisory finding has no
  -- criteria at all, while a best-practice rule has an empty list. A `not null
  -- default '{}'` collapsed those two into one, so a finding saved without the
  -- field read back with `wcagCriteria: []`.
  wcag_criteria      text[],
  conformance_level  text,
  selector           text,
  html_snippet       text,
  help_url           text,
  gateable           boolean,
  confidence         double precision,
  status             text not null default 'open'
                       check (status in ('open', 'fixed', 'dismissed')),
  note               text
);

create index if not exists findings_request_idx on findings (request_id, position);

-- Regression diffing keys on source + code + page + selector. Without the page
-- the same rule on the same selector across two pages collapses into one
-- entry; without the selector, every occurrence of a rule does.
create index if not exists findings_identity_idx
  on findings (source, code, page_url, selector);

-- ---------------------------------------------------------------- reports --

-- `share_token` backs `/r/[token]`, which is unauthenticated by design: a
-- high-entropy, revocable token, `X-Robots-Tag: noindex`, and rate limiting.
-- Revocation is setting it to null, which is why it is nullable.
create table if not exists reports (
  id           text primary key,
  request_id   text not null references runs (request_id) on delete cascade,
  share_token  text unique,
  created_at   timestamptz not null default now()
);

create index if not exists reports_request_idx on reports (request_id);

-- -------------------------------------------------------- activity_events --

-- Attributed to the configured operator name, because there is no per-user
-- identity — see the Phase 2 auth decision. `actor` is a name, not a foreign
-- key, and must not grow into one without that decision being revisited.
create table if not exists activity_events (
  id          bigserial primary key,
  client_id   text references clients (id) on delete set null,
  actor       text not null,
  action      text not null,
  subject     text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists activity_events_created_idx
  on activity_events (created_at desc);

-- ------------------------------------------------------------ adjustments --
--
-- `create table if not exists` does nothing to a table that already exists, so
-- a column whose definition changed after the first migration needs saying
-- again here. These are written to be safe to re-run on a database that is
-- already correct.
--
-- When one of these stops being expressible as an idempotent `alter`, that is
-- the moment to adopt a real migration tool — not before.

alter table findings alter column wcag_criteria drop not null;
alter table findings alter column wcag_criteria drop default;
