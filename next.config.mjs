/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: import.meta.dirname,
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
