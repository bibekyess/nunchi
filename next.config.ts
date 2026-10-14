import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-hosted with Docker: emit a minimal standalone server in .next/standalone.
  output: 'standalone',
  cacheComponents: true,
  partialPrefetching: true,
  // Font files keep their names across deploys, so cache for a month rather than forever.
  async headers() {
    return [
      {
        source: '/fonts/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=2592000' }],
      },
    ];
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
