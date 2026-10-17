import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Code that must run anywhere (browser, server, and later Web Workers): no React, no stores,
// no server-only modules, and nothing from the layers above it.
const PORTABLE_IMPORTS = {
  patterns: [
    {
      group: [
        'react',
        'react/*',
        'react-dom',
        'react-dom/*',
        'zustand',
        'zustand/*',
        'next',
        'next/*',
      ],
      message:
        'Portable code (lib/core, lib/util, engine settings) must not depend on React, Next or stores.',
    },
    {
      group: [
        'server-only',
        '@/lib/server/*',
        '@/lib/store/*',
        '@/lib/settings/use-*',
        '@/components/*',
      ],
      message:
        'Portable code must not import server-only modules, stores, settings hooks or components.',
    },
    {
      group: ['@/lib/engines/*', '!@/lib/engines/ids'],
      message: 'Portable code sits below the engines; name engines via @/lib/engines/ids.',
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['lib/core/**/*.ts', 'lib/util/**/*.ts', 'lib/settings/engine-settings.ts'],
    rules: { 'no-restricted-imports': ['error', PORTABLE_IMPORTS] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'public/vad/**',
  ]),
]);

export default eslintConfig;
