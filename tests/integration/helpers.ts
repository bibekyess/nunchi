import { HttpResponse } from 'msw';

export const SPEACHES = 'https://stt.test/v1';
export const LLM = 'https://llm.test/v1';

export const TEST_ENV = {
  SPEACHES_BASE_URL: SPEACHES,
  SPEACHES_MODEL: 'whisper-test',
  LLM_BASE_URL: LLM,
  LLM_MODEL: 'qwen-test',
  LLM_HEADER_NAME: 'x-gpu-key',
  LLM_HEADER_VALUE: 'secret-value',
};

/** An OpenAI-style SSE stream that sends `pieces` as content deltas. */
export function chatStream(pieces: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const content of pieces) {
        const chunk = {
          id: 'x',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'qwen-test',
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

export function chatJson(content: string): Response {
  return HttpResponse.json({
    id: 'x',
    object: 'chat.completion',
    created: 0,
    model: 'qwen-test',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  });
}

export function wavBlob(bytes = 3200): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'audio/wav' });
}
