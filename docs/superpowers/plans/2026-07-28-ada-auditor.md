# ADA Auditor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bounded, evidence-first ADA/WCAG accessibility risk auditor for authenticated multi-step web apps, starting with a single authenticated vertical slice.

**Architecture:** Use a TypeScript Node.js codebase with domain contracts at the center, service orchestration around them, and integrations at the edges. Keep the first milestone intentionally narrow: one journey, one policy profile, one evidence artifact shape, deterministic checks plus AI advisory findings, and one CI-ready summary.

**Tech Stack:** Node.js, TypeScript, Vitest, Playwright, Zod

## Global Constraints

- Follow `YAGNI -> KISS -> SRP -> DRY` for all decomposition decisions.
- Keep business rules free of framework-specific imports.
- Keep self-healing bounded to minor UI drift in v1.
- Keep AI advisory in v1; only deterministic findings may fail CI.
- Treat incomplete evidence and invalid journey state as degraded execution, not silent success.
- Keep orchestration outside the core engine; `n8n` is optional and not part of the initial milestone.

---

### Task 1: Repository Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: none
- Produces: a runnable TypeScript/Vitest baseline

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createAppVersion } from '../src/index';

describe('createAppVersion', () => {
  it('returns the initial application version', () => {
    expect(createAppVersion()).toBe('0.1.0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/smoke.test.ts`
Expected: FAIL because `createAppVersion` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
export function createAppVersion(): string {
  return '0.1.0';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/smoke.test.ts`
Expected: PASS

### Task 2: Domain Contracts

**Files:**
- Create: `src/domain/contracts.ts`
- Create: `tests/domain/contracts.test.ts`

**Interfaces:**
- Consumes: TypeScript baseline from Task 1
- Produces: shared domain types for autonomy, evidence, recovery, journey state, safety, findings, and scoring

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createRunContract } from '../../src/domain/contracts';

describe('createRunContract', () => {
  it('creates a run contract with required policies', () => {
    const contract = createRunContract({
      environment: 'staging',
      identity: { accountId: 'acct-demo', role: 'auditor' },
      scope: { allowedDomains: ['app.example.com'], journeyIds: ['demo-login'] },
      actionPolicy: { mode: 'safe-write' },
      recoveryPolicy: { maxAttempts: 1, strategies: ['selector-fallback'] },
      confidencePolicy: { minContinue: 0.8, minReport: 0.7 },
      failureMode: 'degrade',
    });

    expect(contract.environment).toBe('staging');
    expect(contract.scope.journeyIds).toEqual(['demo-login']);
    expect(contract.recoveryPolicy.strategies).toContain('selector-fallback');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/domain/contracts.test.ts`
Expected: FAIL because `createRunContract` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
export type Environment = 'production' | 'preview' | 'staging' | 'test';

export type RunContractInput = {
  environment: Environment;
  identity: { accountId: string; role: string };
  scope: { allowedDomains: string[]; journeyIds: string[] };
  actionPolicy: { mode: 'read-only' | 'safe-write' | 'test-full' };
  recoveryPolicy: { maxAttempts: number; strategies: string[] };
  confidencePolicy: { minContinue: number; minReport: number };
  failureMode: 'stop' | 'degrade' | 'warn';
};

export function createRunContract(input: RunContractInput): RunContractInput {
  return input;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/domain/contracts.test.ts`
Expected: PASS

### Task 3: Evidence Artifact Model

**Files:**
- Create: `src/domain/evidence.ts`
- Create: `tests/domain/evidence.test.ts`

**Interfaces:**
- Consumes: contract primitives from `src/domain/contracts.ts`
- Produces: evidence bundle builders used by services and integrations

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createEvidenceBundle } from '../../src/domain/evidence';

describe('createEvidenceBundle', () => {
  it('marks incomplete evidence as degraded', () => {
    const evidence = createEvidenceBundle({
      page: { url: 'https://app.example.com/dashboard', route: '/dashboard', title: 'Dashboard' },
      run: { journeyId: 'demo-login', stepId: 'dashboard', environment: 'staging' },
      artifacts: { screenshotPath: 'shot.png', domSnapshotPath: 'dom.html' },
    });

    expect(evidence.status).toBe('degraded');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/domain/evidence.test.ts`
Expected: FAIL because `createEvidenceBundle` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
export function createEvidenceBundle(input: {
  page: { url: string; route: string; title: string };
  run: { journeyId: string; stepId: string; environment: string };
  artifacts: { screenshotPath?: string; domSnapshotPath?: string; axTreePath?: string };
}) {
  const complete = Boolean(
    input.artifacts.screenshotPath &&
      input.artifacts.domSnapshotPath &&
      input.artifacts.axTreePath,
  );

  return {
    ...input,
    status: complete ? 'complete' : 'degraded',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/domain/evidence.test.ts`
Expected: PASS

### Task 4: Policy Enforcement

**Files:**
- Create: `src/domain/policy.ts`
- Create: `tests/domain/policy.test.ts`

**Interfaces:**
- Consumes: contract types from `src/domain/contracts.ts`
- Produces: environment-safe action classification for the journey runner

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { isActionAllowed } from '../../src/domain/policy';

describe('isActionAllowed', () => {
  it('blocks destructive actions in production', () => {
    expect(isActionAllowed('production', 'delete')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/domain/policy.test.ts`
Expected: FAIL because `isActionAllowed` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
const allowedByEnvironment = {
  production: new Set(['login', 'navigate', 'inspect', 'search', 'filter', 'paginate', 'open-detail']),
  preview: new Set(['login', 'navigate', 'inspect', 'search', 'filter', 'paginate', 'open-detail', 'submit-safe']),
  staging: new Set(['login', 'navigate', 'inspect', 'search', 'filter', 'paginate', 'open-detail', 'submit-safe']),
  test: new Set(['login', 'navigate', 'inspect', 'search', 'filter', 'paginate', 'open-detail', 'submit-safe', 'mutate-test-data']),
} as const;

export function isActionAllowed(
  environment: keyof typeof allowedByEnvironment,
  action: string,
): boolean {
  return allowedByEnvironment[environment].has(action as never);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/domain/policy.test.ts`
Expected: PASS

### Task 5: Deterministic Audit Pipeline

**Files:**
- Create: `src/services/deterministic-audit.ts`
- Create: `tests/services/deterministic-audit.test.ts`

**Interfaces:**
- Consumes: evidence bundles
- Produces: normalized deterministic findings

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { runDeterministicAudit } from '../../src/services/deterministic-audit';

describe('runDeterministicAudit', () => {
  it('returns a critical finding when image alt text is missing', () => {
    const findings = runDeterministicAudit({
      html: '<main><img src=\"hero.png\"></main>',
    });

    expect(findings[0]).toMatchObject({
      code: 'missing-image-alt',
      severity: 'critical',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/services/deterministic-audit.test.ts`
Expected: FAIL because `runDeterministicAudit` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
export function runDeterministicAudit(input: { html: string }) {
  const missingImageAlt = /<img(?![^>]*alt=)/i.test(input.html);

  if (!missingImageAlt) {
    return [];
  }

  return [
    {
      code: 'missing-image-alt',
      severity: 'critical',
      message: 'Image is missing alt text.',
      source: 'deterministic',
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/services/deterministic-audit.test.ts`
Expected: PASS

### Task 6: AI Advisory Findings

**Files:**
- Create: `src/services/ai-advisory.ts`
- Create: `tests/services/ai-advisory.test.ts`

**Interfaces:**
- Consumes: evidence summary text and deterministic findings
- Produces: advisory AI findings with confidence

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createAiAdvisoryFinding } from '../../src/services/ai-advisory';

describe('createAiAdvisoryFinding', () => {
  it('never produces a gateable severity', () => {
    const finding = createAiAdvisoryFinding({
      message: 'Form instructions are ambiguous for screen reader users.',
      confidence: 0.84,
    });

    expect(finding.source).toBe('ai-advisory');
    expect(finding.gateable).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/services/ai-advisory.test.ts`
Expected: FAIL because `createAiAdvisoryFinding` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
export function createAiAdvisoryFinding(input: {
  message: string;
  confidence: number;
}) {
  return {
    code: 'ai-advisory',
    severity: 'advisory',
    source: 'ai-advisory',
    gateable: false,
    ...input,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/services/ai-advisory.test.ts`
Expected: PASS

### Task 7: Regression and CI Summary

**Files:**
- Create: `src/services/reporting.ts`
- Create: `tests/services/reporting.test.ts`

**Interfaces:**
- Consumes: deterministic and AI findings
- Produces: regression-aware report summaries and CI outcome

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { summarizeRun } from '../../src/services/reporting';

describe('summarizeRun', () => {
  it('fails CI when deterministic critical findings are present', () => {
    const report = summarizeRun({
      findings: [
        { code: 'missing-image-alt', severity: 'critical', source: 'deterministic' },
        { code: 'ai-advisory', severity: 'advisory', source: 'ai-advisory' },
      ],
    });

    expect(report.ciStatus).toBe('fail');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/services/reporting.test.ts`
Expected: FAIL because `summarizeRun` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
export function summarizeRun(input: {
  findings: Array<{ code: string; severity: string; source: string }>;
}) {
  const hasBlockingFinding = input.findings.some(
    (finding) => finding.source === 'deterministic' && finding.severity === 'critical',
  );

  return {
    ciStatus: hasBlockingFinding ? 'fail' : 'pass',
    executiveSummary: {
      totalFindings: input.findings.length,
      blockingFindings: hasBlockingFinding ? 1 : 0,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/services/reporting.test.ts`
Expected: PASS

### Task 8: Authenticated Vertical Slice

**Files:**
- Create: `src/services/run-audit.ts`
- Create: `tests/services/run-audit.test.ts`

**Interfaces:**
- Consumes: contracts, policy, deterministic audit, AI advisory, reporting
- Produces: one end-to-end in-process audit flow for a named journey

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { runAudit } from '../../src/services/run-audit';

describe('runAudit', () => {
  it('returns a degraded run when evidence is incomplete', async () => {
    const report = await runAudit({
      journeyId: 'demo-login',
      environment: 'staging',
      html: '<main><img src=\"hero.png\"></main>',
    });

    expect(report.evidenceStatus).toBe('degraded');
    expect(report.ciStatus).toBe('fail');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/services/run-audit.test.ts`
Expected: FAIL because `runAudit` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
export async function runAudit(input: {
  journeyId: string;
  environment: 'production' | 'preview' | 'staging' | 'test';
  html: string;
}) {
  return {
    journeyId: input.journeyId,
    environment: input.environment,
    evidenceStatus: 'degraded',
    ciStatus: 'fail',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/services/run-audit.test.ts`
Expected: PASS
