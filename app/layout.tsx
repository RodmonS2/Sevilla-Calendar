import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://rodmo-family-calendar.sliph320.chatgpt.site'),
  title: 'Together — Family Calendar',
  description: 'A calm, shared three-day calendar for the whole family.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Together',
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title: 'Together — Family Calendar',
    description: 'A calm, shared three-day calendar for the whole family.',
    type: 'website',
    images: [{ url: '/og.png', width: 1732, height: 909, alt: 'Together family calendar' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Together — Family Calendar',
    description: 'A calm, shared three-day calendar for the whole family.',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#e9edf2',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
