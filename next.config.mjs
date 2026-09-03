/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: import.meta.dirname,
  // Pinned for the same reason as `outputFileTracingRoot` below it: inference
  // walks up looking for lockfiles, and in a git worktree it can land outside
  // the checkout entirely — the build then refuses with "couldn't find the
  // Next.js package from the project directory". This app is the repo; its
  // own directory is always the root.
  turbopack: { root: import.meta.dirname },
  // Chromium and its driver must stay real files on disk — bundling them
  // breaks the executable lookup and the /tmp unpack that @sparticuz/chromium
  // performs on a serverless cold start.
  //
  // axe-core is here for a related but distinct reason: `@axe-core/playwright`
  // does not call axe as a library, it reads `axe.source` and injects that
  // string into the page. Bundled, that string is a module wrapper referencing
  // bundler-scoped names, so the injection threw `ReferenceError: module is
  // not defined` (dev) / `ReferenceError: t is not defined` (built) and every
  // run from the Next server failed. Unit and browser tests never caught it
  // because vitest loads the module unbundled — only a run through the app
  // could.
  serverExternalPackages: [
    'playwright-core',
    '@sparticuz/chromium',
    '@axe-core/playwright',
    'axe-core',
    // Same failure mode as axe-core: `htmlcs-scan.ts` reads the built
    // HTMLCS.js by path and evaluates it in the page. Bundling would rewrite
    // the module while the path read goes stale — keep it external, and see
    // the tracing entries below for the path-read half.
    '@pa11y/html_codesniffer',
  ],
  // `serverExternalPackages` keeps these out of the bundle, but it does not
  // make the tracer copy everything they need: only the JavaScript reachable
  // by static analysis comes along. `playwright-core/lib/coreBundle.js`
  // requires `browsers.json` at runtime by path, so the deployed function had
  // the code and not the data, and every audit run died at
  //
  //   Cannot find module '/var/task/node_modules/playwright-core/browsers.json'
  //
  // in under a second — before Chromium was ever asked to launch. The whole
  // package is listed rather than that one file: the same class of miss
  // applies to anything else it reads by path, and a second production-only
  // failure discovered a week later is worth more than the bytes.
  //
  // `@sparticuz/chromium` is here for the same reason and cost a second
  // deployment to learn: its `bin/` holds the brotli-compressed browser, which
  // no `import` mentions, so the tracer left it behind and the run failed with
  // "The input directory …/@sparticuz/chromium/bin does not exist."
  outputFileTracingIncludes: {
    '/api/audit/**': [
      './node_modules/playwright-core/**',
      './node_modules/@sparticuz/chromium/**',
      // Read by path at runtime (`htmlcs-scan.ts` injects the built bundle
      // as a source string) — the browsers.json class of miss exactly.
      './node_modules/@pa11y/html_codesniffer/build/**',
    ],
    // The client-scoped documents route spawns a JVM, not a browser, from a
    // path `/api/documents/**` cannot see. Scoped to `**/documents/**` and
    // placed BEFORE the broader clients entry: the deploy test asserts against
    // the first key that covers a route, and the broader entry would otherwise
    // answer for this one with browser binaries it does not use. Kept out of
    // `/api/platform/clients/**` itself so the other client routes do not each
    // grow a 40MB runtime they never exec.
    // The one documents route that launches a BROWSER, not a JVM: the
    // client-scoped crawl-and-merge. Placed before the JVM entry below for
    // the same first-covering-key reason that entry sits before the broad
    // clients one — the JVM entry would otherwise answer for this route with
    // a runtime it never execs, while the browser it does exec goes
    // unpackaged and dies on its first production request.
    '/api/platform/clients/**/documents/discover/**': [
      './node_modules/playwright-core/**',
      './node_modules/@sparticuz/chromium/**',
      // Read by path at runtime (`htmlcs-scan.ts` injects the built bundle
      // as a source string) — the browsers.json class of miss exactly.
      './node_modules/@pa11y/html_codesniffer/build/**',
    ],
    // The one client-scoped documents route that converts, which needs
    // LibreOffice on top of the JVM — a conversion is two `soffice` runs and
    // two Java stages. Before the JVM entry below for the same
    // first-covering-key reason the browser entry sits before both: that entry
    // would otherwise answer for this route with a toolchain missing the half
    // that does the converting, and the route would deploy clean and refuse
    // every request with `converter_unavailable`.
    '/api/platform/clients/**/documents/convert/**': [
      './vendor/jre/**',
      './vendor/verapdf/**',
      './vendor/pdfbox-app-3.0.8.jar',
      './vendor/fonts/**',
      './dist/documents/classes/**',
      './vendor/libreoffice/**',
    ],
    '/api/platform/clients/**/documents/**': [
      './vendor/jre/**',
      './vendor/verapdf/**',
      './vendor/pdfbox-app-3.0.8.jar',
      './vendor/fonts/**',
      './dist/documents/classes/**',
    ],
    '/api/platform/clients/**': [
      './node_modules/playwright-core/**',
      './node_modules/@sparticuz/chromium/**',
      // Read by path at runtime (`htmlcs-scan.ts` injects the built bundle
      // as a source string) — the browsers.json class of miss exactly.
      './node_modules/@pa11y/html_codesniffer/build/**',
    ],
    // The first browser route outside the two subtrees above. Nothing in the
    // route file says "I need the tracer's help" — that knowledge lives only
    // here — which is why `tests/deploy/browser-routes-are-packaged.test.ts`
    // exists rather than a comment asking people to remember.
    '/api/platform/discover/**': [
      './node_modules/playwright-core/**',
      './node_modules/@sparticuz/chromium/**',
      // Read by path at runtime (`htmlcs-scan.ts` injects the built bundle
      // as a source string) — the browsers.json class of miss exactly.
      './node_modules/@pa11y/html_codesniffer/build/**',
    ],
    // The document stages, which spawn a JVM rather than a browser. Same class
    // of problem as the entries above and the same fix: nothing in the route
    // says "I need these files", that knowledge lives only here, and a route
    // missing them builds clean and dies on its first production request.
    //
    // `vendor/jre` is assembled during `npm run vercel-build`, so this also
    // depends on the tracer running after the build rather than before it.
    // `scripts/prepare-jvm.ts` explains what it produces and why it is 40MB.
    // The two standalone routes that convert rather than only read. Kept out
    // of `/api/documents/**` itself so `inspect` and `inspect-url` do not each
    // grow a 440MB LibreOffice they never exec.
    '/api/documents/remediate/**': [
      './vendor/jre/**',
      './vendor/verapdf/**',
      './vendor/pdfbox-app-3.0.8.jar',
      './vendor/fonts/**',
      './dist/documents/classes/**',
      './vendor/libreoffice/**',
    ],
    '/api/documents/remediate-url/**': [
      './vendor/jre/**',
      './vendor/verapdf/**',
      './vendor/pdfbox-app-3.0.8.jar',
      './vendor/fonts/**',
      './dist/documents/classes/**',
      './vendor/libreoffice/**',
    ],
    '/api/documents/**': [
      './vendor/jre/**',
      './vendor/verapdf/**',
      './vendor/pdfbox-app-3.0.8.jar',
      './vendor/fonts/**',
      './dist/documents/classes/**',
    ],
  },
  // The other direction. Turbopack traces a function's dependencies by
  // static analysis, and when a filesystem call's path cannot be known
  // statically — `libreoffice-runtime.ts` walking `PATH` for a host install,
  // `readdirSync` of a directory reached through a symlink — its answer is to
  // trace the whole project. The build says so in a warning that scrolls past
  // and nothing failed. `[V]` Measured on 2026-09-03: every module importing
  // that resolver — the three converting routes, the settings and remediate
  // pages, `/api/ready` — listed 1,168–1,321 files against 144 for `/api/health`,
  // 756 of them under the five directories below plus every config file at
  // the root; on a checkout holding the blind corpus, the same trace carried
  // 166 real municipal PDFs inside a deployed function. The ignore comments at
  // the calls stop the walk; this list is the second lever, and it says why
  // each directory is junk to a function so that neither has to be re-derived
  // when the next unscopeable call appears. `tests/deploy/` holds the list,
  // and `platform-hydration.test.ts` reads the built traces to hold the result.
  outputFileTracingExcludes: {
    '*': [
      // A feasibility spike outside every gate, with its corpora, keys and
      // Java sources. Even `inspect`, which never walked the project, listed
      // seven of its `.java` files.
      './experiments/**',
      // The suites, the fixture sites they audit, and the prose. A function
      // reads none of them.
      './tests/**',
      './fixtures/**',
      './docs/**',
      // Operator entry points: each calls `main()` at import, which is why no
      // route imports one either.
      './scripts/**',
      // Run output and blind-test output — gitignored, derived from real
      // documents, present on any tree that has run the product locally. A
      // Vercel clone never has them; a local build did, and the hydration
      // suite builds locally.
      './artifacts/**',
      './.doc-blind-test/**',
    ],
  },
  experimental: {
    useTypeScriptCli: true,
  },
  // The portfolio moved from /platform to /. Temporary rather than permanent:
  // a 308 is cached by browsers indefinitely, and this layout is days old.
  async redirects() {
    return [{ source: '/platform', destination: '/', permanent: false }];
  },
};

export default nextConfig;
