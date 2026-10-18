import { describe, expect, it, vi } from 'vitest';

// connection() needs a Next.js request scope; outside one it is irrelevant.
vi.mock('next/server', () => ({ connection: async () => {} }));
const { GET } = await import('@/app/api/live/route');

describe('GET /api/live', () => {
  it('answers without the passcode', async () => {
    vi.stubEnv('APP_ACCESS_TOKEN', 'secret');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
    vi.unstubAllEnvs();
  });
});
