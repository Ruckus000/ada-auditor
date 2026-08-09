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
