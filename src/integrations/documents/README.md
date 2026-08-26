# Document stages

The runtime home for the Java (PDFBox) stages that read and repair PDFs.

| Stage | Does | Writes a file |
|---|---|---|
| `Inspect` | reports the structure tree | no |
| `Finish` | sets `MarkInfo`, `/Lang`, `DisplayDocTitle`, XMP | **yes** |

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

## Verifying a stage that writes

A repair stage's failure mode is a delivered file carrying a claim that is wrong
and invisible: four meaningful images artifacted out of the structure tree look
identical, in the PDF, to four images that were never there. A zero exit code
says the JVM did not crash — nothing more.

So `runWritingStage` returns `StageOutcome`, and **verifying the output is the
caller's job**:

```
inspectDocument(before) → repair → inspectDocument(after)
  → contentChanges(before, after)   // must be []
```

`contentChanges` lives in `domain/document-structure.ts` and needs no ground
truth, which matters because a client's document has none. `Finish` claims in
its own header that it alters no structure element; `java-finish.test.ts` is
what holds it to that.

## `/Lang` has no default, ever

`finishDocument` requires a BCP-47 tag and shape-checks it. Defaulting to `en`
would give every Welsh or bilingual document a false statement about itself —
an *assertion*, in this project's terms, and worse than the omission it
replaced. A caller with no answer must not call the stage.

## Graduating another stage

1. Move the `.java` into `java/` (do not copy — `StructText.java` is shared, and
   two copies drift). `java-spike-still-compiles.test.ts` guards that edge.
2. Add its output schema to `domain/`.
3. Wrap it like `inspect.ts` (reads) or `finish.ts` (writes).
4. If it prints progress lines, give `runStage` an explicit mode.
5. **If it writes, prove what it does not change** before trusting it.

The remaining repair stages are harder than `Finish`, and in a specific way:
each either deletes semantics (`Headings` demotes, `Lists` removes) or invents
them (`Tables` promotes cells to headers). For those, `contentChanges` returning
`[]` is the wrong bar — they are *supposed* to change content — so each needs its
own statement of what it may and may not touch.
