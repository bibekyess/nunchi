// `pnpm dev:mock`: next dev against the mock upstreams in .env.mock. The file is loaded into
// this process's environment (which wins over .env.local) instead of with `node --env-file`:
// next dev passes NODE_OPTIONS on to its worker, and Node refuses --env-file there.
import { spawn } from 'node:child_process';

process.loadEnvFile('.env.mock');
const next = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'dev', ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
// Stopping this script (not only Ctrl+C, which reaches both) must stop the dev server too.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => next.kill(signal));
next.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
