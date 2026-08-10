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
  -- A free-text name, not a foreign key — the same shape as
  -- `activity_events.actor`, and for the same reason: there is no per-user
  -- identity in this product and adding one here would smuggle it in.
  owner       text,
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
  -- What the rule checks, in the engine's own words. Nullable because every
  -- run stored before this column existed has none, and a backfill would have
  -- to invent the sentence for rules whose wording has since changed.
  title              text,
  message            text,
  -- axe's per-check fix messages, kept in the two groups it evaluates them in:
  -- any ONE entry in `remediation_any` clears the finding, every entry in
  -- `remediation_all` has to be done. Nullable for runs stored before these
  -- columns; an empty array means the engine had nothing to add, which is not
  -- the same thing.
  remediation_any    text[],
  remediation_all    text[],
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

-- --------------------------------------------------------- finding triage --
--
-- Triage is keyed on the IDENTITY of a defect, not on the findings row that
-- happened to observe it.
--
-- `PostgresRunStore.saveRun` deletes and reinserts a run's findings on every
-- write — including the write that turns a `running` placeholder into a
-- finished run. Triage stored on that row would not survive a single run, let
-- alone a re-audit. And a dismissal that does not survive re-measurement is
-- not a professional judgement, it is a UI toggle.
--
-- `finding_key` is `source:code:page_url:selector`, produced by `findingKey`
-- in `services/regression.ts` and deliberately NOT recomputed here. One
-- definition of a finding's identity, shared by the regression diff and by
-- triage — two copies would drift and a dismissal would silently stop
-- matching.
--
-- Scoped to the client rather than the journey: two journeys on one site
-- routinely traverse the same page, and an operator who dismissed a contrast
-- failure on a shared header should not have to dismiss it again per journey.
--
-- Only human decisions live here. `fixed` does not: a finding is fixed when
-- the next run stops reporting it, which `compareToBaseline` already computes.
-- A stored `fixed` flag can disagree with the evidence, and when it does the
-- evidence is right.
create table if not exists finding_triage (
  client_id    text not null references clients (id) on delete cascade,
  finding_key  text not null,

  -- Denormalised components of the key, so the table is legible in psql and
  -- queryable by page. The key remains authoritative.
  source       text not null,
  code         text not null,
  page_url     text,
  selector     text,

  state        text not null
                 check (state in ('dismissed', 'accepted-risk', 'assigned')),
  -- Required by the UI for `dismissed` and `accepted-risk`, enforced there
  -- rather than by a check constraint — an `assigned` row legitimately has no
  -- note, and a constraint covering only two of three states reads as a bug.
  note         text,
  assignee     text,
  actor        text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  primary key (client_id, finding_key)
);

create index if not exists finding_triage_client_idx
  on finding_triage (client_id, updated_at desc);

-- ------------------------------------------------------------ adjustments --
--
-- `create table if not exists` does nothing to a table that already exists, so
-- a column whose definition changed after the first migration needs saying
-- again here. These are written to be safe to re-run on a database that is
-- already correct.
--
-- When one of these stops being expressible as an idempotent `alter`, that is
-- the moment to adopt a real migration tool — not before. Phase 2C added the
-- first non-additive changes (two `drop column`s); `drop column if exists` is
-- still idempotent, so that threshold is not yet crossed.

alter table findings alter column wcag_criteria drop not null;
alter table findings alter column wcag_criteria drop default;

alter table clients add column if not exists owner text;

-- Existing rows keep a null title. Not backfilled: the sentence belongs to the
-- rule version that produced the finding, and axe's wording changes between
-- releases — writing today's text onto last month's audit would put words in
-- the mouth of a run that never said them.
alter table findings add column if not exists title text;
alter table findings add column if not exists remediation_any text[];
alter table findings add column if not exists remediation_all text[];

-- The columns `finding_triage` replaces. Never written, never read. Leaving
-- them is the furniture AGENTS.md warns about — and leaving them beside a
-- table that means the same thing is worse, because the next reader has to
-- work out which one is live.
alter table findings drop column if exists status;
alter table findings drop column if exists note;

-- --- Linkage: make the chain client -> journey -> run total ----------------
--
-- `runs.journey_id` has always been free text from the request body, so there
-- was no path from a run to a client and the Portfolio screen had no query to
-- run. Rather than making the API stricter — which would break the run
-- contract suite, chaos, and every existing caller — journeys materialise on
-- demand: `ensureJourney` upserts a row before each run is recorded, and the
-- rows below backfill everything that already exists.

insert into clients (id, name)
values ('client-unassigned', 'Unassigned')
on conflict (id) do nothing;

insert into journeys (id, client_id, name)
select distinct r.journey_id, 'client-unassigned', r.journey_id
from runs r
where not exists (select 1 from journeys j where j.id = r.journey_id)
on conflict (id) do nothing;

update journeys set client_id = 'client-unassigned' where client_id is null;
alter table journeys alter column client_id set not null;

-- Archived rather than deleted, because `runs` cascades from here: a delete
-- button on a journey would destroy its audit history.
alter table journeys add column if not exists archived_at timestamptz;

-- `add constraint` has no `if not exists`, so it is guarded rather than
-- skipped — re-running this file must stay a no-op.
do $$ begin
  alter table runs
    add constraint runs_journey_fk
    foreign key (journey_id) references journeys (id) on delete cascade;
exception when duplicate_object then null; end $$;

-- --- Score -----------------------------------------------------------------
--
-- A conformance rate over the checks actually evaluated: passed / (passed +
-- failed). Nullable on purpose — an inconclusive run has no denominator, and
-- printing a number would assert a measurement nobody made. The ring renders
-- an em dash instead.
alter table runs add column if not exists score integer
  check (score is null or (score >= 0 and score <= 100));

-- Which formula produced it. A score is a claim in a client report, so
-- changing how it is computed must not silently reinterpret every historical
-- run.
alter table runs add column if not exists score_version smallint not null default 1;

-- The score's inputs, per page. `checks_passed` is new evidence: axe reports
-- passes and `scanPageWithAxe` discarded them, so until now there was no
-- denominator anywhere. `checks_incomplete` is counted separately and never as
-- a pass — which is what the product already tells clients.
alter table run_pages add column if not exists checks_passed integer;
alter table run_pages add column if not exists checks_failed integer;
alter table run_pages add column if not exists checks_incomplete integer;

-- --- Reports ---------------------------------------------------------------
--
-- The report screens branch on audience, and a shared link must render from
-- the run it was issued against — never "the latest run", or a link sent to a
-- regulator changes meaning after the next nightly.
alter table reports add column if not exists audience text
  check (audience is null or audience in ('legal', 'dev', 'exec'));
alter table reports add column if not exists title text;
alter table reports add column if not exists issued_by text;
alter table reports add column if not exists revoked_at timestamptz;

-- --- Operators -------------------------------------------------------------
--
-- The Phase 2 decision that `activity_events.actor` "must not grow into a
-- foreign key without that decision being revisited" is hereby revisited, and
-- the answer is: it still does not. Here is what changed and what did not.
--
-- What changed: there are real accounts now. One shared `AUDITOR_RUN_TOKEN`
-- was identity, authentication, authorization and the session signing key all
-- at once, which made three things impossible together — attributing an action
-- to a person, assigning a finding to anyone, and revoking one operator
-- without logging out everybody.
--
-- What did not: there is still exactly ONE organisation. Every operator sees
-- every client. No table gets a tenant column, because there are no mutually
-- distrustful tenants — only people. If that ever changes, it changes here
-- first, exactly as the header of this file says.
--
-- And `actor` stays text. `actor_operator_id` is added *beside* it, nullable,
-- never backfilled. An activity feed is a historical record: an operator who
-- has since been renamed did not do the thing under their new name, and events
-- written by CI or the scheduler have no account to point at. A name and an
-- account are different facts and the table now holds both.
--
-- Re-evaluated against the idempotence threshold at the top of this section:
-- every statement below is `create table if not exists`, `add column if not
-- exists`, or a guarded `add constraint`. Nothing backfills a not-null column
-- and nothing changes a primary key, so the threshold is still not crossed and
-- a migration tool is still not warranted.
create table if not exists operators (
  id             text primary key,
  email          text not null unique,
  name           text not null,
  -- `scrypt$N$r$p$salt$hash`. The cost parameters live in the value so raising
  -- them later does not invalidate every existing row.
  password_hash  text not null,
  -- Bumped to invalidate one operator's outstanding sessions. The cookie
  -- carries the epoch it was minted at, so revocation needs no session table.
  session_epoch  integer not null default 1,
  -- Disabled, never deleted: `activity_events` points here, and deleting an
  -- operator would erase who did what.
  disabled_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Lookup at sign-in is by email, case-insensitively — an address is not
-- case-sensitive to the person who owns it.
create unique index if not exists operators_email_lower_idx on operators (lower(email));

alter table activity_events add column if not exists actor_operator_id text;
alter table finding_triage  add column if not exists assignee_operator_id text;

-- `on delete set null` rather than cascade: an operator row should never be
-- deleted, but if one ever is, losing the account link is survivable and
-- losing the event is not.
do $$ begin
  alter table activity_events
    add constraint activity_events_operator_fk
    foreign key (actor_operator_id) references operators (id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table finding_triage
    add constraint finding_triage_operator_fk
    foreign key (assignee_operator_id) references operators (id) on delete set null;
exception when duplicate_object then null; end $$;

-- --- Timing ----------------------------------------------------------------
--
-- The page cap of 20 and the 300s function limit were both set by guess. These
-- columns are what turns the next decision about them into a measurement.
--
-- `started_at` is also a correctness fix, not only instrumentation.
-- `toStoredRunRecord` mints a fresh `createdAt` on every call and this file's
-- upsert took `excluded.created_at`, so the write that turns a `running`
-- placeholder into a finished run *moved* `created_at` to the completion time.
-- The column therefore meant "when it finished" for a complete run and "when it
-- started" for one that died — and `getLatestRun` orders by it, so baselines
-- were ordered by finish time while the runs they described were ordered by
-- start. `created_at` is now pinned to the earliest write and `started_at`
-- holds the start explicitly.
alter table runs add column if not exists started_at timestamptz;

-- Phase timings as jsonb rather than columns: the phase names will change
-- while we are still learning where a run spends itself, and this is
-- measurement data, not a contract. Contrast `checks_passed`, which is a score
-- input and therefore got real columns.
alter table runs add column if not exists phase_ms jsonb;

alter table run_pages add column if not exists duration_ms integer;
alter table run_pages add column if not exists scan_ms integer;

-- Existing rows: the best available answer is the timestamp we have. Not
-- guessed forward, not left null — a null here would read as "not measured"
-- on runs that predate measurement, which is exactly what it is.
update runs set started_at = created_at where started_at is null;

-- --- Journey environment ---------------------------------------------------
--
-- Which action policy a run against this journey gets. It lived only in a
-- request body, so a stored journey could not be run at all — there was no
-- answer to "run this" without someone typing the environment again.
--
-- Backfilled to `production`, the strictest set in `domain/policy.ts`: no
-- `submit-safe`, no `mutate-test-data`. A tool that walks other people's sites
-- defaults to read-only and makes widening a deliberate, recorded act.
--
-- No check constraint: `environmentSchema` validates at the boundary, and a
-- constraint here is a future `alter` to fight when the set changes.
alter table journeys add column if not exists environment text;
update journeys set environment = 'production' where environment is null;

-- --- Schedule --------------------------------------------------------------
--
-- Cadence lives on the journey, not in a `schedules` table: it is one-to-one
-- with a journey and read every time a journey is read, so a separate table
-- would be a join for one column.
--
-- Three words rather than a cron expression. A per-journey cron string is a
-- parser plus a timezone story, and nobody asked to audit at 03:17 on
-- Tuesdays. `schedule_hour` is UTC, so what "daily" means is answerable.
--
-- `last_scheduled_at` is what makes the tick idempotent. The cron fires
-- hourly, and a journey is claimed by *stamping* this column in the same
-- statement that selects it — there are no transactions on the Neon HTTP
-- driver, so claim-then-work is the only shape available.
alter table journeys add column if not exists schedule text;
alter table journeys add column if not exists schedule_hour smallint;
alter table journeys add column if not exists last_scheduled_at timestamptz;
update journeys set schedule = 'off' where schedule is null;

create index if not exists journeys_schedule_idx
  on journeys (schedule, schedule_hour) where schedule <> 'off';
