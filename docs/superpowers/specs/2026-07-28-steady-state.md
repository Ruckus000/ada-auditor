# ADA Auditor Steady-State (Phase 1)

Operational steady-state definitions for the Vercel control plane. These rules must not regress.

## CI status semantics

| `evidenceStatus` | Deterministic criticals | `ciStatus` |
|---|---|---|
| incomplete (`degraded`) | any | `inconclusive` (never `pass` or `fail`) |
| `complete` | present | `fail` |
| `complete` | none | `pass` |

Incomplete evidence rejects deterministic findings at the service layer (`runAudit` returns no deterministic hits when evidence is degraded).

## Platform resolution

- Explicit `platformHint` wins over HTML heuristics.
- Unknown hints fall back to `generic`.

## AI advisory

- AI findings are advisory only (`gateable: false` in v1).
- AI findings never change `ciStatus` to `fail`.

## Contract enforcement

- Journey must be within run contract `scope.journeyIds`.
- Forbidden production actions throw before audit execution.
- `failureMode: degrade` allows incomplete evidence runs to complete as degraded/inconclusive rather than hard-stop.

## Chaos (auditor platform only)

Gate: `CHAOS_ENABLED=true`

Scenarios exercised by `npm run chaos` and optional API `chaosScenario` inject:

| Scenario | Expected `ciStatus` |
|---|---|
| `omit_ax_tree` | `inconclusive` |
| `complete_critical` | `fail` |
| `complete_clean` | `pass` |

Customer production targets are never chaos-injected in Phase 1.

## Structured run logs

Each audit run emits one JSON log line (`type: audit_run_log`) with:

`journey`, `env`, `platform`, `evidenceStatus`, `ciStatus`, `durationMs`, `failureReason` (on error), `requestId`

## Readiness

- `GET /api/health` — liveness (always OK when process is up)
- `GET /api/ready` — readiness requires `AUDITOR_RUN_TOKEN` configured (503 otherwise)

See also: [Environment variables](env.md)
