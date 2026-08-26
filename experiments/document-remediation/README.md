# Document remediation feasibility spike

Throwaway code. It exists to answer one question and then be deleted or
rewritten:

> Can OpenDataLoader's free Tagged PDF output, plus a modest deterministic
> PDFBox finishing pass, get representative PDFs through veraPDF's
> machine-verifiable PDF/UA checks?

Plan, findings, and decision live in
[`docs/research/document-remediation/`](../../docs/research/document-remediation/).

## Why this does not look like `src/`

It deliberately ignores the production `/domain` `/services` `/integrations`
boundaries. Those exist so business rules survive framework churn; there are no
business rules here, and layering a spike would be the abstraction YAGNI warns
about. Scripts run top to bottom. Repetition is left alone unless it repeats
about three times with the same meaning.

`experiments/**` is outside the production `tsconfig` `include` and is listed in
`eslint.config.mjs` `ignores`, so this directory is typechecked and linted by
nothing. That is the trade a spike is allowed to make. Anything that graduates
into `src/` gets held to the normal gates.

## Three files have graduated

`Inspect.java`, `StructText.java` and `Finish.java` now live in
[`src/integrations/documents/java/`](../../src/integrations/documents/java/) and
are held to the normal gates. They were **moved, not copied** — `StructText` is
used by `Headings.java` and `Tables.java` here, and two copies of a shared file
drift.

So the compile step below reaches into `src/`. That direction is fine: the spike
may depend on production code, never the reverse. Nothing in `src/` resolves a
path into this directory.

## Setup

```bash
./fetch-tools.sh        # veraPDF 1.30.2 + PDFBox 3.0.8 into vendor/
npm ci                  # from the repo root; brings @opendataloader/pdf 2.5.0
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
```

Compile every stage — the ones still here, plus the graduated sources they
depend on:

```bash
"$JAVA_HOME/bin/javac" -cp vendor/pdfbox-app-3.0.8.jar -d out/classes \
  *.java ../../src/integrations/documents/java/*.java
```

`vendor/` and `out/` are gitignored and fully regenerable.
