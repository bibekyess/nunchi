import type { Metadata, Viewport } from 'next';
import { THEME_INIT_SCRIPT } from '@/lib/browser/theme-script';
import './globals.css';

export const metadata: Metadata = {
  title: 'nunchi',
  description: 'Live Korean ↔ English transcription and translation for meetings.',
  icons: {
    // The -dark files are drawn for dark backgrounds (light strokes).
    icon: [
      {
        url: '/nunchi-web-logo-kit/nunchi-favicon.svg',
        type: 'image/svg+xml',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/nunchi-web-logo-kit/nunchi-favicon-dark.svg',
        type: 'image/svg+xml',
        media: '(prefers-color-scheme: dark)',
      },
      { url: '/nunchi-web-logo-kit/favicon-32.png', type: 'image/png', sizes: '32x32' },
    ],
    apple: '/nunchi-web-logo-kit/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // No themeColor here: the theme script owns the single theme-color meta.
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // The inline script sets data-theme before paint, so the server value may differ.
    <html lang="ko" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Latin UI text paints in Satoshi right away; Pretendard (2 MB) loads on demand. */}
        <link
          rel="preload"
          href="/fonts/Satoshi-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin=""
        />
        <link
          rel="preload"
          href="/fonts/Satoshi-Medium.woff2"
          as="font"
          type="font/woff2"
          crossOrigin=""
        />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
