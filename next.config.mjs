/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: import.meta.dirname,
  // Chromium and its driver must stay real files on disk — bundling them
  // breaks the executable lookup and the /tmp unpack that @sparticuz/chromium
  // performs on a serverless cold start.
  serverExternalPackages: ['playwright-core', '@sparticuz/chromium'],
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
