import type { MetadataRoute } from 'next';
import { THEME_COLORS } from '@/lib/theme-script';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'nunchi',
    short_name: 'nunchi',
    description: 'Live Korean ↔ English transcription and translation for meetings.',
    start_url: '/',
    display: 'standalone',
    background_color: THEME_COLORS.light,
    theme_color: THEME_COLORS.light,
    icons: [
      { src: '/nunchi-web-logo-kit/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/nunchi-web-logo-kit/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
