import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ADA Auditor',
  description: 'Evidence-first ADA/WCAG accessibility risk auditor',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
