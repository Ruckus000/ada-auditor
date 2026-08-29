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

-- One row per page of the audited site the journey walked through; a host it
-- only passed through, such as an identity provider, is not captured and has no
-- row. `position` preserves visit
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

-- `share_token` backs `/r/[token]`, which is unauthenticated by design. The
-- token IS the access control: 32 random bytes from `randomBytes(32)`, and
-- revocation is setting it to null, which is why it is nullable.
--
-- This used to claim `X-Robots-Tag: noindex` and rate limiting as well. The
-- header was not sent by anything until the delivery route started sending it;
-- the page had only Next `metadata.robots`, a `<meta>` tag a PDF cannot carry.
-- There is no rate limiting here and never was — `getThrottleStore` has three
-- callers and all three are the console sign-in path. At 256 bits the token is
-- not enumerable, so a limiter was never what stood between a stranger and a
-- report, and a comment claiming one is worse than the absence: it is what the
-- next reader checks instead of the code.
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

-- Repair joined conversion in this table rather than beside it: same hashes,
-- same summary, same audit trail, and one row per delivered file however it
-- was produced. Null reads as 'conversion', which is what every row written
-- before repair existed actually was.
alter table document_conversions add column if not exists kind text;

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
--
-- Nullable, and for the reason `gate_version` is: `not null default 1` made
-- Postgres answer `scoreVersion: 1` for a run that recorded none, while
-- `MemoryRunStore` answered nothing, and a store that invents a field the
-- other does not is the drift `runStoreContract` exists to catch. That is not
-- hypothetical here — it is the same defect `gate_version` shipped with and
-- was fixed for one column over, still live in this one because `FULL_RECORD`
-- happened to carry a `scoreVersion` and so never asked the question.
--
-- The rows already holding 1 keep it, and should: this column was added when
-- score versioning began, so 1 is a true statement about every run written
-- under the old default, not a backfilled guess. `drop default` only stops
-- *new* rows being given a version nobody recorded. Both `alter column` lines
-- are no-ops on a database that never took the earlier form.
alter table runs add column if not exists score_version smallint not null default 1;
alter table runs alter column score_version drop not null;
alter table runs alter column score_version drop default;

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
-- The client's document inventory as it stood at issue time — a snapshot,
-- written once by the issuing route and never recomputed, so the pinning
-- guarantee above covers the whole document. Read and written whole, never
-- queried into — the same jsonb stance as document_inspections.summary.
alter table reports add column if not exists documents jsonb;

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

-- --- Passkeys ------------------------------------------------------------
--
-- What an operator signs in with instead of remembering a password. The
-- device keeps the private key in its own secure hardware; this table holds
-- only the public half, which is why there is no ciphertext here and no key
-- to rotate. A dump of this table lets someone verify a signature and never
-- produce one — the property the whole mechanism exists for.
--
-- Several rows per operator, one per device. That is what makes a lost laptop
-- survivable: the phone still signs in, and nobody has to reach for the CLI.
--
-- `credential_id` is the primary key rather than a surrogate: the
-- authenticator chooses it, it is unique across every operator, and a sign-in
-- arrives carrying nothing else — a discoverable credential names its own
-- owner, so the lookup has to be by exactly this value.
--
-- **Cascade here, unlike `activity_events` below.** An operator row is
-- disabled rather than deleted precisely so history survives its account; a
-- credential has the opposite nature — past its operator it is unusable bytes
-- naming a device nobody can sign in as.
create table if not exists operator_passkeys (
  credential_id text primary key,
  operator_id   text not null references operators (id) on delete cascade,
  -- Base64url COSE key, as the authenticator encoded it. Stored verbatim
  -- rather than re-encoded: the verifier wants the bytes it was given.
  public_key    text not null,
  -- The authenticator's use counter. Compared, not trusted — synced passkeys
  -- report zero forever, so zero means "not counting". See
  -- `isCounterRegression` in `domain/platform.ts`.
  sign_counter  bigint not null default 0,
  -- Hints like 'usb,hybrid'. Null when the authenticator offered none.
  transports    text,
  -- Operator-supplied device name. UNTRUSTED — escape on render.
  label         text not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

-- The management screen lists one operator's credentials; the sign-in path
-- goes through the primary key and needs no index of its own.
create index if not exists operator_passkeys_operator_idx
  on operator_passkeys (operator_id);

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
-- statement that selects it. Claim-then-work is the shape because a claim that
-- is not atomic with the select lets two overlapping ticks start one journey
-- twice.
alter table journeys add column if not exists schedule text;
alter table journeys add column if not exists schedule_hour smallint;
alter table journeys add column if not exists last_scheduled_at timestamptz;
update journeys set schedule = 'off' where schedule is null;

create index if not exists journeys_schedule_idx
  on journeys (schedule, schedule_hour) where schedule <> 'off';

-- ------------------------------------------------------- run intent (2026-08) --

-- What a run was asked to walk, as opposed to what it walked.
--
-- Every other column on `runs` is outcome. Nothing recorded the intent, so
-- nothing could tell a run that audited five pages from one that audited five
-- *different* pages — and `getLatestRun` picks a regression baseline on
-- `journey_id` and `environment` alone. `/api/audit/run` accepts `journey_id`
-- and `steps` independently, so one call naming an existing journey with a
-- different path becomes the next run's baseline, and every finding the real
-- journey has that the impostor did not is reported as *resolved*.
--
-- Nullable, and nullable means "not recorded" — never "the same path as some
-- other run". Runs written before this column exist and must not start
-- comparing as though they agreed.
alter table runs add column if not exists intent jsonb;

-- --------------------------------------------------- page http status (2026-08) --

-- The main-frame HTTP status a page was served with.
--
-- `page.goto`'s response was discarded and nothing anywhere read a status, so
-- a 500, a 404, an expired-session 403 or a bot challenge was navigated to,
-- scanned, screenshotted and stored exactly like the page it stood in for.
-- Error pages are small and clean, so a run that hit one scored *higher* than
-- a real audit and reported `pass`.
--
-- The judgement made from it — 400 and above cannot be complete evidence —
-- lives in `createEvidenceBundle`, not here. This column is the fact, kept so
-- that a degraded page can say which kind of degraded it was: a missing
-- screenshot and a 500 are different problems for different people.
--
-- Nullable, and null means "not measured", never 200. A `file://` fixture run
-- has no HTTP status at all, and every page recorded before this column has
-- none either.
alter table run_pages add column if not exists status_code integer;

-- Extra hosts one journey may pass through, beyond the target's own.
--
-- For third-party sign-in: an app that hands off to Okta or Entra is refused
-- on its first step without this, because the allowlist is otherwise the
-- target's host alone. Null and empty read the same — the target's own host is
-- added by the runner and is never stored here.
--
-- Matched host-or-subdomain, which is why `allowedHostsSchema` refuses a bare
-- public suffix at write time. What contains a wrong entry is not this column:
-- a pass-through host is never audited, every hop's peer address is
-- range-checked, and the run must still come to rest on the target.
alter table journeys add column if not exists allowed_hosts text[];

-- Which gate produced `ci_status`. Same reason `score_version` exists, for the
-- same kind of claim: a stored `pass` means nothing on its own once the
-- question behind it has changed, and a client's trend line would show a cliff
-- where no site changed at all.
--
-- Nullable, and absent means *not recorded* rather than "version 1" — the
-- stance `intent.ruleset` documents for the same kind of provenance field. A
-- store that invents a version the record never carried is a store that has
-- drifted from `MemoryRunStore`, which holds what it was handed; the shared
-- contract catches exactly that.
--
-- The two `alter column` lines are for databases that already took an earlier
-- form of this column as `not null default 1`. Both are no-ops otherwise.
alter table runs add column if not exists gate_version smallint;
alter table runs alter column gate_version drop not null;
alter table runs alter column gate_version drop default;

-- ----------------------------------------------- client credentials (2026-08) --

-- The values behind a journey's `credentialRef`s, per client, encrypted.
--
-- The reference stays in the journey and the steady-state rule stands:
-- credentials are referenced, never inlined. What this table moves is the
-- *value* — from `AUDIT_CREDENTIAL_<REF>_<FIELD>` deployment variables, which
-- take a redeploy and a hand on the environment, to a row an operator writes
-- once through a write-only API. Resolution at run time is store first, env
-- fallback second, so every existing journey keeps working.
--
-- `*_ciphertext` is AES-256-GCM under `AUDITOR_CREDENTIAL_KEY`, written and
-- read only by `PostgresPlatformStore` via `credential-cipher.ts`, as
-- `v1:<hex nonce>:<hex tag>:<hex ct>` with a fresh nonce per write. Both
-- columns are `not null` because a login is a pair, and half of one is a run
-- that fails its `expect` step by design. Losing the key means re-entering
-- credentials — the designed recovery; there is no export.
--
-- Cascade on the client: a client's credentials have no meaning past the
-- client, and an orphaned password row is exactly the kind of furniture this
-- schema refuses to keep.
create table if not exists client_credentials (
  client_id       text not null references clients (id) on delete cascade,
  ref             text not null,
  user_ciphertext text not null,
  pass_ciphertext text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (client_id, ref)
);

-- Which bound cut the walk short: 'page-cap' or 'budget'.
--
-- `truncated_pages` says a run did not cover its journey; this says what to do
-- about it. A page cap means raise the cap; a wall-clock budget means get a
-- container worker. The console rendered "this run stopped at its page limit"
-- for every truncated run, which the moment a second bound exists is
-- true-sounding and wrong about the cause.
--
-- Nullable, no default, and **no backfill**. A run from before the walk had a
-- clock had no reason, and writing one onto it would put words in its mouth —
-- the same stance `title` and `intent.ruleset` take. Text rather than a CHECK
-- or an enum: the values live in `domain/run-limits.ts`, and inventing this
-- repository's first CHECK-altering migration for a field only our own writer
-- populates is risk without a reader.
alter table runs add column if not exists truncation_reason text;

-- ---------------------------------------------------- document_inspections --
--
-- What the document instrument said about one of a client's documents, kept.
-- Discovery records the PDFs a crawl saw and an operator inspects them one at
-- a time (each inspection is a fetch plus a JVM run); before this table the
-- result lived exactly as long as the browser tab, so an operator who
-- inspected thirty documents and closed the tab had nothing.
--
-- `summary` is the RemediationSummary verbatim, `titleText` included, as
-- jsonb: it is read and written whole, never queried into — the same shape
-- argument as `journeys.steps` — and the database already holds client DOM
-- snippets in `findings`, beside which a document title is mild. The rule
-- that stays absolute is about logs, not storage: a log line carries counts
-- and the hostname only, because document paths routinely name people.
--
-- `url` is the document's address for a crawl record and the operator's own
-- filename for an upload, which is the only handle an upload has. `found_on`
-- is the page the crawl saw the link on; nullable because an upload was found
-- nowhere, and null means exactly that.
--
-- `on delete cascade` from `clients`, like `journeys`: an inspection of a
-- client's document has no meaning once the client row is gone.
create table if not exists document_inspections (
  id            text primary key,
  client_id     text not null references clients (id) on delete cascade,
  url           text not null,
  found_on      text,
  -- 'crawl' | 'upload'. Text rather than a CHECK, the `truncation_reason`
  -- stance: the values live in `domain/platform.ts`, only our own writer
  -- populates this, and a CHECK-altering migration for it is risk without a
  -- reader.
  source        text not null,
  summary       jsonb not null,
  inspected_at  timestamptz not null default now()
);

-- Serves the one query the screen makes: a client's inspections, newest
-- first, capped.
create index if not exists document_inspections_client_idx
  on document_inspections (client_id, inspected_at desc);

-- ------------------------------------------------------- client_documents --
--
-- One of a client's documents — the entity, not an action on it. Inspections
-- and conversions attach to this row; a re-scan refreshes `last_seen_at`
-- instead of starting from nothing. One row per distinct `url` per client
-- (the unique index below is what the merge upserts against); first sighting
-- wins `found_on`, matching discovery's own rule.
--
-- `url` is the document's address for a crawl sighting and the operator's
-- filename for an upload. Same storage stance as `document_inspections`:
-- fine to store, never to log.
create table if not exists client_documents (
  id             text primary key,
  client_id      text not null references clients (id) on delete cascade,
  url            text not null,
  -- 'pdf' | 'docx' | 'doc' — `DocumentLinkKind`, same spelling both
  -- classifiers use. Text rather than a CHECK, the `truncation_reason`
  -- stance.
  kind           text not null,
  -- 'crawl' | 'upload'.
  source         text not null,
  found_on       text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);

create unique index if not exists client_documents_identity_idx
  on client_documents (client_id, url);

-- The inventory query: a client's documents, most recently seen first.
create index if not exists client_documents_client_idx
  on client_documents (client_id, last_seen_at desc);

-- The document an inspection is a reading of. Nullable in DDL because the
-- column arrives after rows exist; the backfill below fills it and every
-- writer since supplies it, so a null here after migration is a defect.
alter table document_inspections add column if not exists document_id text;

-- Backfill, idempotent: give every already-inspected URL a document row, then
-- point its inspections at it. `on conflict do nothing` keeps re-runs and
-- races harmless; the update touches only rows the previous run missed.
-- `id` reuses the oldest inspection's id — stable across re-runs, no
-- generator needed in DDL.
insert into client_documents (id, client_id, url, kind, source, found_on, first_seen_at, last_seen_at)
select distinct on (client_id, url)
  'doc-' || id, client_id, url,
  -- Everything inspected before this table existed was a PDF: the inspect
  -- routes accept nothing else.
  'pdf', source, found_on, inspected_at, inspected_at
from document_inspections
order by client_id, url, inspected_at asc
on conflict (client_id, url) do nothing;

update document_inspections di
set document_id = cd.id
from client_documents cd
where di.document_id is null
  and cd.client_id = di.client_id
  and cd.url = di.url;

-- ---------------------------------------------------- document_conversions --
--
-- One conversion of a client's document — the audit trail. The bytes went to
-- the operator; what stays is the identity of what went in and what came out
-- (`sha256` each way) plus the pipeline's own account, verbatim. The hashes
-- make the record checkable by anyone holding the delivered file, without
-- this database ever holding document bytes. An artifact pointer column can
-- join later without reshaping this.
create table if not exists document_conversions (
  id             text primary key,
  client_id      text not null references clients (id) on delete cascade,
  document_id    text not null references client_documents (id) on delete cascade,
  summary        jsonb not null,
  input_sha256   text not null,
  output_sha256  text not null,
  converted_at   timestamptz not null default now()
);

-- The inventory's "latest conversion" lookup and any per-document history.
create index if not exists document_conversions_document_idx
  on document_conversions (document_id, converted_at desc);

-- INSTRUMENT_VERSION at reading time (see domain/document-remediation.ts).
-- Nullable: rows written before the stamp read as version 1, which is true —
-- the vocabulary had not changed while they were being written.
alter table document_inspections add column if not exists instrument_version int;
alter table document_conversions add column if not exists instrument_version int;

-- Where the delivered bytes live, when a blob store was configured at
-- conversion time. Server-side handle only — routes stream through it, never
-- serialise it. Under the `documents/` prefix, which the evidence pruner
-- (`prefix: 'runs/'`) never sweeps: a delivered document is the product, not
-- evidence with a window, and it lives until its rows do.
alter table document_conversions add column if not exists artifact_url text;
