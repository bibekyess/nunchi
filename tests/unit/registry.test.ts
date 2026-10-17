import { describe, expect, it } from 'vitest';
import { serverSpeech, serverSummary, serverTranslate } from '@/lib/engines/server';
import { BUILT_ENGINES, buildEngines, needsNetwork } from '@/lib/engines/registry';
import { EngineError } from '@/lib/errors';
import { DEFAULT_ENGINE_CHOICE } from '@/lib/settings/engines';

describe('engine registry', () => {
  it('uses the server engines by default', () => {
    expect(buildEngines(DEFAULT_ENGINE_CHOICE)).toEqual({
      speech: serverSpeech,
      translate: serverTranslate,
      summary: serverSummary,
    });
    expect([...BUILT_ENGINES]).toEqual(['server']);
  });

  it('never falls back to the server for an engine that is not built yet', async () => {
    const engines = buildEngines({ speech: 'device', translate: 'endpoint', summary: 'server' });
    expect(engines.speech.id).toBe('device');
    expect(engines.translate.id).toBe('endpoint');
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
    ).rejects.toThrow(/Custom processing isn't available yet/);
  });

  it('needs the network while any task uses the server', () => {
    expect(needsNetwork(DEFAULT_ENGINE_CHOICE)).toBe(true);
    expect(needsNetwork({ speech: 'device', translate: 'device', summary: 'server' })).toBe(true);
    expect(needsNetwork({ speech: 'device', translate: 'device', summary: 'device' })).toBe(false);
  });
});
