import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatModel, ChatOptions, SpeechModel } from '@/lib/core/models';
import { startSummary, summaryLines } from '@/lib/core/summarize';
import { transcribeWithFallback } from '@/lib/core/transcribe';
import { runTranslation, startTranslation } from '@/lib/core/translate';
import type { TranscriptionResult } from '@/lib/types';

interface Call {
  kind: 'stream' | 'complete';
  messages: ChatMessage[];
  opts: ChatOptions;
}

/** A ChatModel that streams `pieces` and answers `complete` calls from `answers` in turn. */
function fakeChat(pieces: string[], answers: string[] = []) {
  const calls: Call[] = [];
  const abort = vi.fn();
  const chat: ChatModel = {
    async stream(messages, opts) {
      calls.push({ kind: 'stream', messages, opts });
      return {
        async *[Symbol.asyncIterator]() {
          yield* pieces;
        },
        abort,
      };
    },
    async complete(messages, opts) {
      calls.push({ kind: 'complete', messages, opts });
      return answers[calls.filter((c) => c.kind === 'complete').length - 1] ?? '';
    },
  };
  return { chat, calls, abort };
}

async function collect(text: AsyncIterable<string>) {
  let out = '';
  for await (const piece of text) out += piece;
  return out;
}

const translateInput = {
  text: '번역 잘 되고 있나요?',
  sourceLang: 'ko' as const,
  targetLang: 'en' as const,
  context: [],
  glossary: [],
};

describe('startTranslation', () => {
  it('removes a think block split across chunks', async () => {
    const { chat, calls } = fakeChat(['<thi', 'nk>\n\n</think>', '\n\nIs it ', 'working?']);
    const run = await startTranslation(chat, translateInput);
    expect(await collect(run.text)).toBe('Is it working?');
    expect(run.emptyRetry).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts).toMatchObject({ temperature: 0.2, maxTokens: 400 });
  });

  it('retries once, deterministically and without streaming, when the stream is empty', async () => {
    const { chat, calls } = fakeChat(['<think>', '</think>', '\n'], ['<think></think>Is it?']);
    const run = await startTranslation(chat, translateInput);
    expect(await collect(run.text)).toBe('Is it?');
    expect(run.emptyRetry).toBe(true);
    expect(calls.map((c) => c.kind)).toEqual(['stream', 'complete']);
    expect(calls[1].opts).toMatchObject({ temperature: 0, maxTokens: 400 });
    expect(calls[1].messages).toEqual(calls[0].messages);
  });

  it('does not retry after the request was aborted', async () => {
    const { chat, calls } = fakeChat([]);
    const controller = new AbortController();
    const run = await startTranslation(chat, translateInput, controller.signal);
    controller.abort();
    expect(await collect(run.text)).toBe('');
    expect(calls).toHaveLength(1);
  });

  it('uses temperature 0 for a client retry, and abort() stops the upstream', async () => {
    const { chat, calls, abort } = fakeChat(['Yes.']);
    const run = await startTranslation(chat, { ...translateInput, retry: true });
    expect(calls[0].opts.temperature).toBe(0);
    run.abort();
    expect(abort).toHaveBeenCalled();
  });

  it('runTranslation reports each piece and resolves with the whole text', async () => {
    const { chat } = fakeChat(['Hello', ', world']);
    const onDelta = vi.fn();
    expect(await runTranslation(chat, translateInput, onDelta)).toBe('Hello, world');
    expect(onDelta.mock.calls).toEqual([['Hello'], [', world']]);
  });
});

describe('summaryLines', () => {
  it('sorts by seq and drops blank lines', () => {
    expect(
      summaryLines([
        { seq: 2, sourceText: '둘', translation: 'two' },
        { seq: 1, sourceText: '  ' },
        { seq: 0, sourceText: '영' },
      ]),
    ).toEqual(['[0] 영', '[2] 둘 => two']);
  });
});

describe('startSummary', () => {
  const input = { glossary: [], outputLang: 'en' as const };

  it('streams one summary for a short transcript, think block removed', async () => {
    const { chat, calls } = fakeChat(['<think>\n</think>\n\n', '## Overview\n', 'Done.']);
    const onPartsDone = vi.fn();
    const run = await startSummary(chat, input, ['[0] 안녕'], { onPartsDone });
    expect(await collect(run.text)).toBe('## Overview\nDone.');
    expect(calls).toHaveLength(1);
    expect(calls[0].opts).toMatchObject({ temperature: 0.2, maxTokens: 1500, timeoutMs: 180_000 });
    expect(onPartsDone).not.toHaveBeenCalled();
  });

  it('summarizes a long transcript in parts, in order, then streams the merge', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `[${i}] ${'가'.repeat(1000)}`);
    const { chat, calls } = fakeChat(
      ['merged'],
      ['<think>x</think> partial A ', 'partial B', 'partial C'],
    );
    const onPartsDone = vi.fn();
    const run = await startSummary(chat, input, lines, { onPartsDone });
    expect(await collect(run.text)).toBe('merged');

    const parts = calls.filter((c) => c.kind === 'complete');
    expect(parts.length).toBe(2);
    expect(parts[0].messages[0].content).toContain('part 1 of 2');
    expect(parts[1].messages[0].content).toContain('part 2 of 2');
    expect(parts[0].opts).toMatchObject({ maxTokens: 800, timeoutMs: 180_000 });
    expect(onPartsDone).toHaveBeenCalledWith(2, expect.any(Number));

    const merge = calls.at(-1)!;
    expect(merge.kind).toBe('stream');
    expect(merge.messages[1].content).toContain('### Part 1\npartial A\n\n### Part 2\npartial B');
  });
});

describe('transcribeWithFallback', () => {
  const result = (text: string, language: string | undefined): TranscriptionResult => ({
    text,
    language,
    durationMs: 800,
    segments: [],
  });
  const wav = new Float32Array(1600);

  function fakeSpeech(...results: TranscriptionResult[]) {
    const transcribe = vi.fn<SpeechModel['transcribe']>();
    for (const r of results) transcribe.mockResolvedValueOnce(r);
    return { speech: { transcribe } satisfies SpeechModel, transcribe };
  }

  it('retries once in Korean when auto-detect picks an unsupported language', async () => {
    const { speech, transcribe } = fakeSpeech(result('ね', 'ja'), result('네.', undefined));
    const out = await transcribeWithFallback(speech, wav, { language: 'auto', prompt: '지민.' });
    expect(out.result).toMatchObject({ text: '네.', language: 'ko' });
    expect(out.fallbackMs).toEqual(expect.any(Number));
    expect(transcribe.mock.calls[0][1]).toMatchObject({ language: undefined, prompt: '지민.' });
    expect(transcribe.mock.calls[1][1]).toMatchObject({ language: 'ko', prompt: '지민.' });
  });

  describe('with a hint from the previous line', () => {
    const scored = (text: string, language: string, avgLogprob: number): TranscriptionResult => ({
      ...result(text, language),
      segments: [{ text, noSpeechProb: 0.01, avgLogprob }],
    });
    const long = new Float32Array(16 * 3000);

    it('re-hears a short clip in the hint language and keeps the more confident answer', async () => {
      const { speech, transcribe } = fakeSpeech(
        scored('Yes.', 'en', -0.9),
        scored('네.', 'ko', -0.3),
      );
      const out = await transcribeWithFallback(speech, wav, { language: 'auto', hint: 'ko' });
      expect(transcribe.mock.calls[1][1]).toMatchObject({ language: 'ko' });
      expect(out.result.text).toBe('네.');
      expect(out.fallback).toBe('hint-used');
    });

    it('keeps the first guess when it scores better or the same', async () => {
      for (const [first, retried] of [
        [-0.2, -0.8],
        [0, 0], // what a server without scores reports
      ]) {
        const { speech } = fakeSpeech(scored('Yes.', 'en', first), scored('예스.', 'ko', retried));
        const out = await transcribeWithFallback(speech, wav, { language: 'auto', hint: 'ko' });
        expect(out.result.text).toBe('Yes.');
        expect(out.fallback).toBe('hint-kept');
      }
    });

    it('trusts auto-detect on longer clips, after an English line and without scores', async () => {
      for (const [first, audio, hint] of [
        [scored('Yes.', 'en', -0.9), long, 'ko'],
        [scored('네.', 'ko', -0.9), wav, 'en'],
        [result('Yes.', 'en'), wav, 'ko'],
      ] as const) {
        const { speech, transcribe } = fakeSpeech(first);
        const out = await transcribeWithFallback(speech, audio, { language: 'auto', hint });
        expect(transcribe).toHaveBeenCalledTimes(1);
        expect(out.fallback).toBeUndefined();
      }
    });

    it('still retries an unsupported language in Korean', async () => {
      const { speech, transcribe } = fakeSpeech(result('ね', 'ja'), result('네.', undefined));
      const out = await transcribeWithFallback(speech, long, { language: 'auto', hint: 'en' });
      expect(transcribe.mock.calls[1][1]).toMatchObject({ language: 'ko' });
      expect(out.result).toMatchObject({ text: '네.', language: 'ko' });
      expect(out.fallback).toBe('unsupported');
    });
  });

  it('keeps a supported detection, a forced language and empty text as they are', async () => {
    for (const [language, first] of [
      ['auto', result('Hello', 'en')],
      ['en', result('ね', 'ja')],
      ['auto', result('', 'ja')],
    ] as const) {
      const { speech, transcribe } = fakeSpeech(first);
      const out = await transcribeWithFallback(speech, wav, { language });
      expect(out.result).toBe(first);
      expect(out.fallbackMs).toBeUndefined();
      expect(transcribe).toHaveBeenCalledTimes(1);
    }
  });
});
