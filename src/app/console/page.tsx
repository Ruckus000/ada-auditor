import type { Metadata } from 'next';
import { ControlPlane } from '../components/control-plane';

export const metadata: Metadata = {
  title: 'ADA Auditor — operator console',
  description:
    'Run a demo audit and read the pass/fail/inconclusive result. Not legal certification.',
};

export default function ConsolePage() {
  return <ControlPlane />;
}
