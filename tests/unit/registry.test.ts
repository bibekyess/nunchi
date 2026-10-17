import { describe, expect, it } from 'vitest';
import { serverSpeech, serverSummary, serverTranslate } from '@/lib/engines/server';
import { BUILT_ENGINES, buildEngines, needsNetwork } from '@/lib/engines/registry';
import { EngineError } from '@/lib/errors';
import { DEFAULT_ENDPOINTS, DEFAULT_ENGINE_CHOICE } from '@/lib/settings/engine-settings';

describe('engine registry', () => {
  it('uses the server engines by default', () => {
    expect(buildEngines(DEFAULT_ENGINE_CHOICE)).toEqual({
      speech: serverSpeech,
      translate: serverTranslate,
      summary: serverSummary,
    });
    expect([...BUILT_ENGINES]).toEqual(['server', 'endpoint']);
  });

  it('never falls back to the server for an engine that is not built yet', async () => {
    const engines = buildEngines(
      { speech: 'device', translate: 'device', summary: 'server' },
      DEFAULT_ENDPOINTS,
    );
    expect(engines.speech.id).toBe('device');
    expect(engines.translate.id).toBe('device');
    expect(engines.summary).toBe(serverSummary);
    expect(await engines.speech.status()).toEqual({ state: 'unavailable', reason: 'Coming soon.' });

    const err = await engines.speech
      .transcribe(new Float32Array(16), { language: 'auto' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err).toMatchObject({ kind: 'unavailable', retryable: false });
    await expect(
      engines.translate.translate(
        { text: 'x', sourceLang: 'ko', targetLang: 'en', context: [], glossary: [] },
        () => {},
      ),
    ).rejects.toThrow(/This device processing isn't available yet/);
  });

  it('needs the network while any task uses the server', () => {
    expect(needsNetwork(DEFAULT_ENGINE_CHOICE, DEFAULT_ENDPOINTS)).toBe(true);
    expect(
      needsNetwork({ speech: 'device', translate: 'device', summary: 'server' }, DEFAULT_ENDPOINTS),
    ).toBe(true);
    expect(
      needsNetwork({ speech: 'device', translate: 'device', summary: 'device' }, DEFAULT_ENDPOINTS),
    ).toBe(false);
  });

  it('builds custom endpoint engines; only remote endpoints need the network', () => {
    const local = {
      ...DEFAULT_ENDPOINTS.translate,
      baseUrl: 'http://localhost:11434/v1',
      model: 'm',
    };
    const remote = { ...local, baseUrl: 'https://gpu.example.com/v1' };
    const all = { speech: 'endpoint', translate: 'endpoint', summary: 'endpoint' } as const;
    const engines = buildEngines(all, {
      speech: local,
      translate: local,
      summary: { ...local, sameAsTranslate: true },
    });
    expect([engines.speech.id, engines.translate.id, engines.summary.id]).toEqual([
      'endpoint',
      'endpoint',
      'endpoint',
    ]);
    expect(
      needsNetwork(all, {
        speech: local,
        translate: local,
        summary: { ...remote, sameAsTranslate: true },
      }),
    ).toBe(false); // the summary borrows the (local) translation endpoint
    expect(
      needsNetwork(all, {
        speech: local,
        translate: local,
        summary: { ...remote, sameAsTranslate: false },
      }),
    ).toBe(true);
  });
});
