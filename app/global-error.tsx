'use client';

import { useEffect } from 'react';

// Replaces the root layout when it crashes, so nothing from it (styles, fonts, theme) can be
// relied on: a self-contained page that follows the OS color scheme. Colors match globals.css.
const STYLES = `
:root { color-scheme: light dark; --bg: #f4f4f4; --card: #ffffff; --ink: #231212; --muted: #6b6163; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #16121a; --card: #1f1a24; --ink: #f3eef4; --muted: #aaa0b0; }
}
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: 16px; box-sizing: border-box; background: var(--bg); color: var(--ink);
  font: 15px/1.5 system-ui, -apple-system, sans-serif; }
main { max-width: 22rem; width: 100%; text-align: center; background: var(--card);
  border-radius: 16px; padding: 32px 24px 24px; box-shadow: 0 8px 30px rgb(0 0 0 / 0.08); }
h1 { font-size: 1.25rem; margin: 0; }
p { color: var(--muted); font-size: 0.875rem; margin: 8px 0 24px; }
button { font: inherit; font-weight: 500; min-height: 44px; padding: 0 20px; border: 0;
  border-radius: 999px; background: var(--ink); color: var(--bg); cursor: pointer; }
`;

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error('[app] layout crashed', error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <title>nunchi</title>
        <style>{STYLES}</style>
        <main>
          <h1>Something went wrong</h1>
          <p>nunchi stopped working. Lines already transcribed are saved on this device.</p>
          <button type="button" onClick={() => retry()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
