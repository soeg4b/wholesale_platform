import './globals.css';
import type { Metadata } from 'next';
import { Providers } from '@/components/Providers';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { PwaInit } from '@/components/PwaInit';

export const metadata: Metadata = {
  title: 'Wholesale Network Marketplace',
  description:
    'Platform universal B2B untuk jual-beli link jaringan - vendor-agnostic dan non-diskriminatif. / A universal, vendor-agnostic B2B marketplace for network links.',
  manifest: '/manifest.webmanifest',
  applicationName: 'WNMP',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'WNMP' },
  icons: { apple: '/icons/apple-touch-icon.png' },
  formatDetection: { telephone: false },
};

export const viewport = {
  themeColor: '#184c9b',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <Providers>
          <Navbar />
          <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
          <Footer />
          <PwaInit />
        </Providers>
      </body>
    </html>
  );
}
