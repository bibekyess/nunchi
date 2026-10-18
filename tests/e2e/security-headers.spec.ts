import { expect, test } from '@playwright/test';

// The policy itself is exercised by the other specs: they fail on any console error, which
// includes CSP violations (speech detection's WebAssembly, custom endpoint calls, fonts).
test('pages and API routes send the security headers', async ({ request }) => {
  for (const path of ['/', '/api/health']) {
    const headers = (await request.get(path)).headers();
    expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy'], path).toContain("object-src 'none'");
    expect(headers['permissions-policy'], path).toContain('microphone=(self)');
    expect(headers['x-content-type-options'], path).toBe('nosniff');
    expect(headers['x-frame-options'], path).toBe('DENY');
    expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
  }
});
