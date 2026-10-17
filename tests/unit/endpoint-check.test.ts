import { describe, expect, it, vi } from 'vitest';
import { checkEndpoint, CORS_HINT } from '@/lib/engines/endpoint-check';
import { EMPTY_ENDPOINT } from '@/lib/settings/engine-settings';

const config = { ...EMPTY_ENDPOINT, baseUrl: 'http://localhost:11434/v1', model: 'qwen3:4b' };

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init ?? {}),
  ) as unknown as typeof fetch;
}

const models = (...ids: string[]) => Response.json({ data: ids.map((id) => ({ id })) });
const answer = () => Response.json({ choices: [{ message: { content: 'OK' } }] });

describe('checkEndpoint', () => {
  it('passes when the model list loads and the model answers', async () => {
    const fetch = fakeFetch((url) => (url.endsWith('/models') ? models('qwen3:4b') : answer()));
    expect(await checkEndpoint(config, 'chat', { fetch })).toEqual({
      ok: true,
      message: 'Connected. qwen3:4b answered.',
      models: ['qwen3:4b'],
    });
  });

  it('only lists models for speech, warning when the model is not listed', async () => {
    const fetch = fakeFetch(() => models('whisper-small'));
    const result = await checkEndpoint({ ...config, model: 'whisper-large' }, 'speech', { fetch });
    expect(result).toMatchObject({ ok: true, message: 'Connected (1 model).' });
    expect(result.ok && result.warning).toContain("isn't in the server's model list");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks for a model once connected, offering the list', async () => {
    const fetch = fakeFetch(() => models('a', 'b'));
    expect(await checkEndpoint({ ...config, model: '' }, 'chat', { fetch })).toEqual({
      ok: false,
      message: 'Connected (2 models). Now pick a model.',
      models: ['a', 'b'],
    });
  });

  it('calls a failed request to a server that does answer a CORS block', async () => {
    const fetch = fakeFetch((_url, init) => {
      if (init.mode === 'no-cors') return new Response(null, { status: 200 });
      throw new TypeError('Failed to fetch');
    });
    const result = await checkEndpoint(config, 'chat', { fetch });
    expect(result).toMatchObject({ ok: false, hint: CORS_HINT });
    expect(result.message).toContain('(CORS)');
    expect(CORS_HINT).toContain('OLLAMA_ORIGINS');
  });

  it('says the server is unreachable when nothing answers', async () => {
    const fetch = fakeFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    expect((await checkEndpoint(config, 'chat', { fetch })).message).toBe(
      "Couldn't reach localhost:11434. Is the server running, and is the URL right?",
    );
  });

  it('tells a refused key, a wrong path and a missing model apart', async () => {
    const refused = fakeFetch(() => new Response('', { status: 401 }));
    expect((await checkEndpoint(config, 'chat', { fetch: refused })).message).toBe(
      'localhost:11434 refused the API key (401).',
    );

    const noPath = fakeFetch(() => new Response('', { status: 404 }));
    expect((await checkEndpoint(config, 'chat', { fetch: noPath })).message).toContain(
      'usually end in /v1',
    );

    const noModel = fakeFetch((url) =>
      url.endsWith('/models') ? models('other') : new Response('', { status: 404 }),
    );
    expect(await checkEndpoint(config, 'chat', { fetch: noModel })).toMatchObject({
      ok: false,
      message: 'localhost:11434 has no model named “qwen3:4b”.',
      models: ['other'],
    });
  });

  it('blocks plain http to another machine from an https page without trying', async () => {
    const fetch = fakeFetch(() => models());
    const remote = { ...config, baseUrl: 'http://192.168.1.20:11434/v1' };
    const result = await checkEndpoint(remote, 'chat', { fetch, pageProtocol: 'https:' });
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain('mixed content');
    expect(fetch).not.toHaveBeenCalled();

    // localhost is allowed from https pages.
    const local = fakeFetch((url) => (url.endsWith('/models') ? models('qwen3:4b') : answer()));
    expect((await checkEndpoint(config, 'chat', { fetch: local, pageProtocol: 'https:' })).ok).toBe(
      true,
    );
  });

  it('sends the key, custom header and thinking flag in the test request', async () => {
    const seen: RequestInit[] = [];
    const fetch = fakeFetch((url, init) => {
      seen.push(init);
      return url.endsWith('/models') ? models('qwen3:4b') : answer();
    });
    await checkEndpoint(
      { ...config, apiKey: 'k', headerName: 'x-gw', headerValue: 'v', disableThinking: true },
      'chat',
      { fetch },
    );
    const headers = seen[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k');
    expect(headers['x-gw']).toBe('v');
    expect(JSON.parse(seen[1].body as string)).toMatchObject({
      max_tokens: 1,
      chat_template_kwargs: { enable_thinking: false },
    });
  });
});
