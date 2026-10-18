import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

/**
 * A static CSP: a nonce-based one would force every page to render per request. So inline
 * scripts stay allowed (Next's own, and the theme script), but scripts, frames and plugins
 * from other origins are blocked. `connect-src` must stay open: custom endpoints can be any
 * http(s) URL the user enters. Speech detection runs ONNX in WebAssembly, hence
 * 'wasm-unsafe-eval' and blob: workers. Dev adds eval (React's debug stacks) and HMR sockets.
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
  "worker-src 'self' blob:",
  `connect-src 'self' https: http:${isDev ? ' ws:' : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  // Microphone and tab capture for this site only. The camera isn't denied: Chrome then logs a
  // violation whenever the mic picker lists devices.
  { key: 'Permissions-Policy', value: 'microphone=(self), display-capture=(self), geolocation=()' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // For browsers without frame-ancestors.
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  // Self-hosted with Docker: emit a minimal standalone server in .next/standalone.
  output: 'standalone',
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      // Font files keep their names across deploys, so cache for a month rather than forever.
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
