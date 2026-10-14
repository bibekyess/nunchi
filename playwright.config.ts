import { defineConfig, devices } from '@playwright/test';

// Smoke test: real Chromium with a fake microphone playing tests/fixtures/speech-en.wav,
// against the production build and the mock upstreams. Run `pnpm build` first.
const PORT = 3100;
// Override when 8788 is taken on this machine.
const MOCK_PORT = process.env.E2E_MOCK_PORT ?? '8788';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    permissions: ['microphone'],
    launchOptions: {
      // Use the preinstalled browser when present (cloud dev boxes); otherwise Playwright's own.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--use-file-for-fake-audio-capture=tests/fixtures/speech-en.wav',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'], browserName: 'chromium' } }],
  webServer: [
    {
      command: 'node scripts/mock-upstreams.mjs',
      env: { MOCK_PORT, MOCK_HEADER_NAME: 'x-mock-auth', MOCK_HEADER_VALUE: 'mock-secret' },
      url: `http://localhost:${MOCK_PORT}/v1/models`,
      reuseExistingServer: false,
    },
    {
      command: `node node_modules/next/dist/bin/next start -p ${PORT}`,
      env: {
        SPEACHES_BASE_URL: `http://localhost:${MOCK_PORT}/v1`,
        LLM_BASE_URL: `http://localhost:${MOCK_PORT}/v1`,
        LLM_MODEL: 'mock-qwen',
        LLM_HEADER_NAME: 'x-mock-auth',
        LLM_HEADER_VALUE: 'mock-secret',
      },
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
    },
  ],
});
