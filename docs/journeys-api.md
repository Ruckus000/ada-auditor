# Journeys over the API

For CI, scripts, and a server-to-server caller such as Clayton Platform.
Operators use the console — these endpoints exist so a pipeline can register
and run journeys with the machine credential (`AUDITOR_RUN_TOKEN`), which is
deliberately not something the UI teaches humans to hold: what it does is not
attributed to a person.

Production host: `https://ada-auditor-psi.vercel.app`.

This file is the contract. There is no OpenAPI sidecar. If the two disagree,
the routes win and this file is wrong.

## Tenancy (there is none)

One organisation: every authenticated caller can read every client and every
run. Client ids in the URL are **routing**, not an access-control list.
`getRun` takes a request id and nothing else — that is pinned by
`tests/support/run-store-contract.ts`. Clayton must own project authorization
and the mapping from its projects to auditor client/journey ids. Do not treat
`/api/platform/clients/{clientId}/…` as isolation.

## Two auth layers (do not merge)

### 1. Vercel Deployment Protection (edge, before the app)

- **Production** (`ada-auditor-psi.vercel.app`): not enabled. Send application
  auth only.
- **Auditor preview deployments**: SSO is on. Authorized automation sends both:

```http
x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET
Authorization: Bearer $AUDITOR_RUN_TOKEN
```

`VERCEL_AUTOMATION_BYPASS_SECRET` is Vercel’s automation bypass (generate it
in Deployment Protection if a caller must hit previews). It is **not**
`AUDITOR_RUN_TOKEN`. Query-string bypass is forbidden here — URLs are stored
on `run_pages`, reports, and logs.

### 2. Application auth

`Authorization: Bearer $AUDITOR_RUN_TOKEN` or `x-auditor-run-token`. Token is
at least 16 characters; comparison is constant-time. Configured on the
deployment (anonymous `GET /api/ready` reports `auditorRunTokenConfigured`).

Keep `AUDITOR_SESSION_SECRET` a distinct value so rotating the machine token
does not sign operators out. Rotation: `vercel env rm` / `env add`
`AUDITOR_RUN_TOKEN` for production and preview, then redeploy. After that the
old token 401s; Clayton updates its secret store. Never print values in docs,
tickets, or logs.

Clayton’s backend is the only holder of either secret. Municipal browsers,
Clayton’s frontend, and agents never receive them. The operator console uses
session cookies, not the machine token.

## Which door to use

`POST /api/platform/clients/{clientId}/journeys/{journeyId}/runs` is the
platform door. It refuses a journey with no `targetUrl` or no steps
(`journey_not_runnable` / `journey_has_no_steps`) so it cannot file a fixture
audit under a real client.

`POST /api/audit/run` is the generic/CI door. Without `targetUrl` it falls
back to the local fixture app. Clayton should not use it.

The platform journey-run route has no `wait=1`. Poll.

## Flow

Create a client:

```http
POST /api/platform/clients
Authorization: Bearer $AUDITOR_RUN_TOKEN
Content-Type: application/json

{"name":"Clayton / PropertyPro","contractType":"audit"}
```

`201`:

```json
{
  "requestId": "…",
  "client": {
    "id": "clayton-propertypro",
    "name": "Clayton / PropertyPro",
    "contractType": "audit"
  }
}
```

`contractType` is `audit` | `audit-and-remediate` | `remediation-only`.

Optional credentials (write-only). PUT never echoes values; GET lists
presence (`ref`, which fields are set, when it changed):

```http
PUT /api/platform/clients/{clientId}/credentials/{ref}
Content-Type: application/json

{"user":"…","pass":"…"}
```

`200` `{ "ref": "login", "fields": ["user", "pass"] }`. Without
`AUDITOR_CREDENTIAL_KEY` on the deployment this answers `503`
`credential_store_not_configured` — env-var fallbacks
`AUDIT_CREDENTIAL_<REF>_USER` / `_PASS` still resolve at run time if set.
`GET /api/platform/clients/{clientId}/credentials` is presence only.

Create a journey. `targetUrl` must be https (or http), no userinfo. Extra
`allowedHosts` are IdP hostnames only (max 10); the target host is added from
`targetUrl` at run time. `environment` is `production` | `preview` |
`staging` | `test` (`production` when unsaid — the strictest policy).

```http
POST /api/platform/clients/{clientId}/journeys
Content-Type: application/json

{
  "name": "PropertyPro sign-in",
  "targetUrl": "https://example.vercel.app/",
  "environment": "staging",
  "allowedHosts": ["idp.example.com"],
  "steps": [
    {"action": "navigate", "type": "goto", "path": "/"},
    {"action": "login", "type": "fill", "selector": "#email", "credentialRef": "login", "field": "user"},
    {"action": "login", "type": "fill", "selector": "#password", "credentialRef": "login", "field": "pass"},
    {"action": "submit-safe", "type": "click", "selector": "button[type=submit]"},
    {"action": "inspect", "type": "expect", "urlIncludes": "/dashboard"}
  ]
}
```

A literal password in a step, or `user:pass@` in `targetUrl`, is
`inline_credential` (`400`) and is never stored. GET of a journey projects
steps through `toStepViews`: a stored literal value does not round-trip.

Start a run. Send `Idempotency-Key` so a dropped `202` can be retried without
a second Chromium walk. Valid: 1–256 printable ASCII, no whitespace. Absent
header = a new run every time (console and cron stay that way).

```http
POST /api/platform/clients/{clientId}/journeys/{journeyId}/runs
Idempotency-Key: clayton:propertypro:2026-09-09:attempt-1
Content-Type: application/json

{"environment":"staging"}
```

`202`:

```json
{
  "requestId": "8f3c1a2b-…",
  "journeyId": "…",
  "environment": "staging",
  "status": "running",
  "pollUrl": "/api/audit/runs/8f3c1a2b-…"
}
```

The same key again returns the same `202` shape with the **original**
`requestId` and `pollUrl`. No second audit, no second budget unit. An invalid
key is `400` `invalid_idempotency_key` and mints no row.

Poll until `run.status` is `complete` or `failed`. Interval about 2s; give up
after about 7 minutes (`AUDITOR_RUN_STALE_SECONDS`, default 360, plus a
minute of grace). A placeholder `running` row is written first; a killed
invocation is reconciled on read and by `/api/cron/tick` to `failed` /
`run_timed_out` once stale. Treat a still-`running` row past that window as
becoming `failed` — the GET already does.

```http
GET /api/audit/runs/{requestId}
Authorization: Bearer $AUDITOR_RUN_TOKEN
```

`200`. The outer `requestId` is a **trace id** for this GET, not the run’s id.
Read `run.status`, `run.ciStatus`, `run.evidenceStatus`, `run.findings`.

```json
{
  "requestId": "trace-…",
  "run": {
    "requestId": "8f3c1a2b-…",
    "journeyId": "…",
    "environment": "staging",
    "status": "complete",
    "ciStatus": "fail",
    "evidenceStatus": "complete",
    "findings": [
      {
        "code": "image-alt",
        "severity": "serious",
        "source": "deterministic",
        "pageUrl": "https://example.vercel.app/",
        "selector": "img.hero",
        "wcagCriteria": ["1.1.1"],
        "conformanceLevel": "A"
      },
      {
        "code": "color-contrast",
        "severity": "needs-review",
        "source": "deterministic",
        "pageUrl": "https://example.vercel.app/"
      }
    ]
  }
}
```

Optional shareable HTML (public; the token is the ACL; **no artifacts**):

```http
POST /api/platform/clients/{clientId}/reports
{"requestId":"8f3c1a2b-…"}
```

`201` `{ "report": { "id", "shareToken", "shareUrl": "/r/{shareToken}" } }`.
`GET /r/{shareToken}` needs no machine token. Revoke the report to 404 the
old URL. The share pins that `requestId`; it is never “the latest”.

Authenticated evidence (machine token required):

- `GET /api/audit/runs/{requestId}/report.pdf`
- `GET /api/audit/runs/{requestId}/artifacts/{position}/{kind}`
  (`screenshot` | `dom` | `axtree`; `position` is the page index)

Without the token: `401`. Pruned evidence: `410` `evidence_pruned`.

Verify without auditing: `POST …/journeys/{journeyId}/preview`.
Archive: `DELETE …/journeys/{journeyId}`.

Steps must satisfy `authoredStepSchema` (`src/domain/journey-step.ts`).
`action` is one of `login`, `navigate`, `inspect`, `search`, `filter`,
`paginate`, `open-detail`, `submit-safe`, `mutate-test-data` — not free
prose. Credentials are always `credentialRef` — a literal password in a
step body is refused as `inline_credential`, and so is a `targetUrl` that
embeds one.

## Lifecycle, evidence, findings

**Lifecycle** (`run.status`): `running` | `complete` | `failed`.
`failureReason` examples: `run_timed_out`, `journey_step_failed`,
`navigation_not_allowed`.

**Evidence:** `evidenceStatus` is `complete` | `degraded` | `unknown`.
Incomplete evidence → `ciStatus: "inconclusive"` (never `pass`, never
`fail`). Deterministic findings from incomplete pages are rejected. One page
missing an artifact makes the whole run inconclusive.

**Findings — three kinds, do not merge:**

| Kind | How to spot it | Gates the run? | In the score? |
|---|---|---|---|
| Deterministic violation | `source: "deterministic"`, severity is not `needs-review` | Yes, if it cites WCAG A/AA | Yes |
| Needs review | `severity: "needs-review"` (axe `incomplete`, or HTML_CodeSniffer) | Never | Never |
| AI advisory | `source: "ai-advisory"`, `gateable: false` | Never | Never |

**Truncation** (`truncationReason: "page-cap" | "budget"`) is still a real
audit of what was seen, not a timeout. **Timeout** is `failed` /
`run_timed_out` after the stale window.

## Preview targets and SSRF

App login uses `credentialRef` fill steps. Values must not appear in journey
GET, `intent`, reports, or logs.

The browser does **not** send `x-vercel-protection-bypass` to the *target*.
Putting that secret on `targetUrl` would persist it. For a Vercel-protected
target: disable Vercel Authentication on that staging deployment, or use a
URL that is not SSO-gated. Keep the app’s own login behind `credentialRef`.

RFC1918, loopback, and metadata IPs are refused
(`src/integrations/browser/target-url.ts`). A `targetUrl` of
`http://127.0.0.1/` fails the run as `navigation_not_allowed` (or is refused
before start). Subresource fetches are not SSRF-checked.

Do not put `x-vercel-protection-bypass` (or any secret) in `targetUrl`.

## Advisory

Do not globally set `AUDITOR_ADVISORY_MODEL=off` unless every public audit
should be silent too. Authenticated journeys (a step with `credentialRef`)
already skip the free/default model (`advisory_skipped_authenticated_journey`
in `src/services/ai-advisory.ts`). Confirm production flags via
authenticated `GET /api/ready` (`advisoryConfigured`,
`credentialStoreConfigured`, `warnings`) — anonymous `/api/ready` omits
those. Point authenticated targets at a model with a data-handling guarantee
only after explicit approval.

Unauthenticated journeys still run the advisory unless the model is `off` or
a guaranteed id.

## Error codes

| Code | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | Missing or wrong machine token |
| `invalid_request_body` | 400 | JSON/schema failed |
| `invalid_idempotency_key` | 400 | Header present but not 1–256 printable ASCII without whitespace; no row |
| `inline_credential` | 400 | Password in a step, or userinfo in `targetUrl`; no row |
| `client_not_found` | 404 | Unknown client id |
| `journey_not_found` | 404 | Unknown, archived, or belongs to another client |
| `run_not_found` | 404 | Unknown request id |
| `journey_not_runnable` | 422 | Stored journey has no `targetUrl` |
| `journey_has_no_steps` | 422 | Stored journey has no steps |
| `invalid_journey_steps` | 422 | Stored steps fail the runner schema |
| `credential_store_not_configured` | 503 | PUT credential without `AUDITOR_CREDENTIAL_KEY` |
| `run_budget_exceeded` | 429 | Cap hit; **no row**; `window` + `resetsInSeconds` in the body |
| `navigation_not_allowed` | on the **failed run** | Target/host/address out of scope or private |
| `evidence_pruned` | 410 | Artifact bytes past retention |

Anonymous `GET /api/audit/runs` is `401` application JSON `{ "error": "unauthorized" }`,
not a Vercel SSO page (production).

## Remaining limitations

- One organisation, no tenancy; Clayton must not treat client ids as an ACL.
- A run cannot outlive the function `maxDuration` (300s). Long crawls need a
  container worker.
- Budget `429` writes no row. The counter fails open if Redis is down.
- Vercel-protected **targets** cannot be bypassed through this API without
  leaking secrets into stored URLs.
- Subresource fetches are not SSRF-checked.
- Public `/r/{token}` is share-token ACL only; revoke to 404. It never lists
  artifacts.
- Advisory still runs on **unauthenticated** journeys unless the model is
  `off` or a guaranteed id.
- `wait=1` exists on `POST /api/audit/run` only, for CI. The platform
  journey-run route always returns `202`.
