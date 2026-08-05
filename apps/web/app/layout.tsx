import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DeepResearch',
  description: 'Asynchronous research reports over scientific literature, with cited sources.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
