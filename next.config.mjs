/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: import.meta.dirname,
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
  outputFileTracingIncludes: {
    '/api/audit/**': ['./node_modules/playwright-core/**'],
    '/api/platform/clients/**': ['./node_modules/playwright-core/**'],
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
