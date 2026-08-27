import type { Metadata } from 'next';
import { connection } from 'next/server';
import { ControlPlane } from '../components/control-plane';

export const metadata: Metadata = {
  title: 'ADA Auditor — operator console',
  description:
    'Run a demo audit and read the pass/fail/inconclusive result. Not legal certification.',
};

/**
 * `await connection()` is what keeps this page renderable under the CSP.
 *
 * A nonce is minted per request and injected during server-side rendering, so
 * a page prerendered at build time — when there is no request — has scripts
 * carrying no nonce, which `strict-dynamic` then refuses. Every other screen
 * reads `cookies()` through the auth gate and is dynamic already; this one is
 * a bare shell around a client component and was the only static page left.
 *
 * The failure it prevents is silent: the page still builds, still returns 200,
 * and renders nothing but an empty body with errors only in the browser
 * console.
 */
export default async function ConsolePage() {
  await connection();
  return <ControlPlane />;
}
