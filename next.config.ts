import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-hosted with Docker: emit a minimal standalone server in .next/standalone.
  output: 'standalone',
  cacheComponents: true,
  partialPrefetching: true,
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
