import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadSession, NunchiDB, saveSession, setDb } from '@/lib/db/dexie';
import { sessionStore } from '@/lib/session/store';

const state = () => sessionStore.getState();

beforeEach(() => {
  sessionStore.setState({ session: null });
  state().startSession(`s${Math.random()}`);
});

describe('Session.engines', () => {
  it('records the engines and leaves the session untouched when they did not change', () => {
    expect(state().session?.engines).toBeUndefined();
    state().setSessionEngines({ speech: 'server', translate: 'server', summary: 'server' });
    const recorded = state().session;
    expect(recorded?.engines).toEqual({ speech: 'server', translate: 'server', summary: 'server' });

    state().setSessionEngines({ speech: 'server', translate: 'server', summary: 'server' });
    expect(state().session).toBe(recorded);

    state().setSessionEngines({ speech: 'device', translate: 'server', summary: 'server' });
    expect(state().session?.engines?.speech).toBe('device');
  });

  it('is saved and loaded without a database schema change', async () => {
    setDb(new NunchiDB(`engines-${Math.random()}`));
    state().setSessionEngines({ speech: 'server', translate: 'endpoint', summary: 'server' });
    await saveSession(state().session!);
    const loaded = await loadSession(state().session!.id);
    expect(loaded?.session.engines).toEqual({
      speech: 'server',
      translate: 'endpoint',
      summary: 'server',
    });
  });
});
