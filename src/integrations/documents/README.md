# Document stages

The runtime home for the Java (PDFBox) stages that read and repair PDFs. One
stage lives here so far: **`Inspect`**, which reports a document's structure tree
and writes nothing.

## Why this exists

The document pipeline was built in `experiments/document-remediation/`, which is
outside the production `tsconfig` `include` and inside `eslint.config.mjs`
`ignores` — typechecked and linted by nothing, by design, because a spike is
allowed that trade. Nothing in `src/` could consume it, and nothing should have.

This is the seam: a typed, gated boundary where a JVM subprocess's stdout is
validated into plain data.

## Layering

```
domain/document-structure.ts    the contract (zod), no subprocess, no framework
integrations/documents/         resolves a JVM, spawns it, validates output
```

Nothing above this directory knows a JVM exists. That is the same seam
`services/deterministic-audit.ts` holds against axe-core — plain data crosses,
the engine does not — and it is what keeps the layers testable apart.
**`services/` must not import this**; the settings page resolves availability and
passes it into `readDeploymentConfig`.

## Absence is a state, not an error

`resolveJavaRuntime()` returns a discriminated result, never a throw. Vercel
functions have no Java, so `available: false` is the **expected** answer in
production, not a fault — the same distinction `ArtifactRead` makes between
`pruned` and missing.

`/api/ready` reports `documentToolchainAvailable` in `checks` and deliberately
adds **no warning**: on every deployed environment this is permanently false, and
a warnings array with a permanent entry is one people stop reading.

## Setup

```bash
npm run build:documents
```

Fetches PDFBox 3.0.8 into `vendor/` (gitignored) and compiles
`src/integrations/documents/java/*.java` into `dist/documents/classes`
(gitignored). Needs a JDK 17+, via `JAVA_HOME` or on `PATH`.

The repo tracks **zero binaries** and this must not change that.

## Tests

| Suite | Covers |
|---|---|
| `npm test` | the schema, and every stage failure mode via an injected executor — **no JVM** |
| `npm run test:documents` | `Inspect` against a real JVM and a real PDF |

The real-JVM tests skip themselves, naming the missing piece, when no toolchain
is present. Their PDF fixture is generated at test time by `renderPdf()` rather
than committed.

## Output convention

`Inspect` prints one JSON document as the whole of stdout. Some other spike
stages print progress lines and put JSON on the **last** line; `runStage` does
not support that yet, deliberately — no such stage has graduated, and a parser
guessing between the two would eventually guess wrong on a document whose text
ends in a brace.

## Graduating another stage

1. Move the `.java` into `java/` (do not copy — `StructText.java` is shared, and
   two copies drift).
2. Add its output schema to `domain/`.
3. Wrap it like `inspect.ts`.
4. If it prints progress lines, give `runStage` an explicit mode.

A **repair** stage writes a PDF, so its worst case is a delivered file carrying a
wrong claim that no reviewer can see. `Inspect` was first precisely because it
cannot do that.
