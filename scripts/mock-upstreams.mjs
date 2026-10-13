#!/usr/bin/env node
// Fake Speaches + fake vLLM (OpenAI-compatible) server for local development and smoke tests.
// Usage: pnpm mock   (listens on MOCK_PORT, default 8787; base URL http://localhost:8787/v1)
//
// Behaviour:
//   GET  /v1/models                 -> model list
//   POST /v1/audio/transcriptions   -> canned Korean sentence (or English if language=en)
//   POST /v1/chat/completions       -> streamed canned translation (or a canned markdown
//                                      summary for summary prompts), preceded by an empty
//                                      <think></think> block split across chunks, like Qwen3
// Set MOCK_HEADER_NAME/MOCK_HEADER_VALUE to require the custom LLM auth header.
// Set MOCK_LATENCY_MS to add delay (default 150).

import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 8787);
const LATENCY = Number(process.env.MOCK_LATENCY_MS ?? 150);
const HEADER_NAME = process.env.MOCK_HEADER_NAME?.toLowerCase();
const HEADER_VALUE = process.env.MOCK_HEADER_VALUE;

const KO_LINES = [
  '안녕하세요, 오늘 회의를 시작하겠습니다.',
  '키로가 이번 밋업에 스폰서로 참여하게 됐습니다.',
  '번역 잘 되고 있나요?',
];
const EN_LINES = ['Is the translation working well?', 'Thanks everyone for coming today.'];
const TRANSLATIONS = {
  '안녕하세요, 오늘 회의를 시작하겠습니다.': "Hello, let's start today's meeting.",
  '키로가 이번 밋업에 스폰서로 참여하게 됐습니다.':
    'Kiro is participating in this meetup as a sponsor.',
  '번역 잘 되고 있나요?': 'Is the translation working well?',
  'Is the translation working well?': '번역 잘 되고 있나요?',
  'Thanks everyone for coming today.': '오늘 와 주셔서 모두 감사합니다.',
};

/** Canned markdown summary that mentions how many transcript lines it saw. */
function mockSummary(user) {
  const lines = (user.match(/^\[\d+\] /gm) ?? []).length;
  return [
    '## Overview',
    `The team opened the meeting and confirmed Kiro as a sponsor (${lines} lines).`,
    '',
    '## Key points',
    '- Kiro is sponsoring the meetup.',
    '- Live translation is being checked.',
    '',
    '## Action items',
    '- [ ] Kiro: confirm sponsorship details',
  ].join('\n');
}

let counter = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Pull a simple text field out of a multipart body without a parser. */
function multipartField(body, name) {
  const m = body.toString('latin1').match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`));
  return m?.[1];
}

/** WAV duration from the data chunk size, assuming 16-bit mono. */
function wavSeconds(body) {
  const i = body.indexOf('data');
  if (i === -1) return 0;
  const fmt = body.indexOf('fmt ');
  const rate = fmt !== -1 ? body.readUInt32LE(fmt + 12) : 16000;
  return body.readUInt32LE(i + 4) / (rate * 2);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    // Clients abort requests all the time (stop button, page close); keep serving.
    console.log(`[mock] ${req.method} ${req.url} aborted: ${err.code ?? err.message}`);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

async function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  console.log(`[mock] ${req.method} ${url.pathname}`);
  await sleep(LATENCY);

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    return json(res, 200, {
      object: 'list',
      data: [
        { id: 'Systran/faster-whisper-large-v3', object: 'model' },
        { id: 'mock-qwen', object: 'model' },
      ],
    });
  }

  if (req.method === 'POST' && url.pathname === '/v1/audio/transcriptions') {
    const body = await readBody(req);
    const language = multipartField(body, 'language');
    const seconds = wavSeconds(body);
    const english = language === 'en';
    const lines = english ? EN_LINES : KO_LINES;
    const text = lines[counter++ % lines.length];
    return json(res, 200, {
      task: 'transcribe',
      language: english ? 'en' : 'ko',
      duration: seconds,
      text: ` ${text}`,
      segments: [
        {
          id: 0,
          start: 0,
          end: seconds,
          text: ` ${text}`,
          no_speech_prob: 0.02,
          avg_logprob: -0.21,
        },
      ],
    });
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    if (HEADER_NAME && req.headers[HEADER_NAME] !== HEADER_VALUE) {
      return json(res, 401, { error: { message: 'missing custom header' } });
    }
    const body = JSON.parse((await readBody(req)).toString('utf8'));
    const user = body.messages?.at(-1)?.content ?? '';
    const system = body.messages?.[0]?.content ?? '';
    const current = user.split('CURRENT line:\n')[1]?.trim() ?? '';
    const answer = /meeting transcripts|partial summaries/.test(system)
      ? mockSummary(user)
      : (TRANSLATIONS[current] ??
        (/[가-힣]/.test(current) ? `[EN] ${current}` : `[KO] ${current}`));

    if (!body.stream) {
      return json(res, 200, {
        id: 'mock',
        object: 'chat.completion',
        model: body.model,
        choices: [
          { index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' },
        ],
      });
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const pieces = ['<thi', 'nk>\n\n</th', 'ink>\n\n', ...answer.match(/\S+\s*/g)];
    for (const content of pieces) {
      const chunk = {
        id: 'mock',
        object: 'chat.completion.chunk',
        model: body.model,
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      await sleep(40);
    }
    res.write(
      `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    );
    res.end('data: [DONE]\n\n');
    return;
  }

  json(res, 404, { error: { message: 'not found' } });
}

server.listen(PORT, () => {
  console.log(`[mock] Speaches + LLM mock listening on http://localhost:${PORT}/v1`);
});
