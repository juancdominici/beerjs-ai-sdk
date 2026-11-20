import { createOpenAI } from '@ai-sdk/openai';
import { streamText, type InferGenerateOutput, type LanguageModel, type OutputInterface, type ToolSet } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { DemoConfig } from '../shared/contracts.ts';

export const CHATGPT_MODEL = 'gpt-6-luna';

export function createGetModel(config: DemoConfig, fetchImpl?: typeof fetch): () => LanguageModel {
  if (!config.chatgptToken) {
    const model = createMockLanguageModel();
    return () => model;
  }

  const model = createOpenAI({
    apiKey: config.chatgptToken,
    fetch: (input, init) => chatGPTResponsesFetch(fetchImpl ?? globalThis.fetch, input, init),
  }).responses(CHATGPT_MODEL);
  return () => model;
}

function chatGPTResponsesFetch(fetchImpl: typeof fetch, input: RequestInfo | URL, init?: RequestInit) {
  // ChatGPT plan usage requires streaming and excludes the API token budget field.
  const body = JSON.parse(String(init?.body));
  delete body.max_output_tokens;
  body.store = false;
  return fetchImpl(input, { ...init, body: JSON.stringify(body) });
}

export async function generateDemoOutput<OUTPUT extends OutputInterface>(
  options: Parameters<typeof streamText<ToolSet, Record<string, unknown>, OUTPUT>>[0],
): Promise<InferGenerateOutput<OUTPUT>> {
  return await streamText(options).output;
}

export const DEFAULT_CHUNK_MS = 8;

export const DEFAULT_CHUNK_SIZE = 14;

function chunkText(text: string, size: number): string[] {
  if (text.length === 0) {
    return [''];
  }
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

export function abortableDelay(
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (ms <= 0 || signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function* createProgressiveTextStream(
  text: string,
  signal: AbortSignal,
  chunkMs: number = DEFAULT_CHUNK_MS,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): AsyncIterable<string> {
  const chunks = chunkText(text, chunkSize);
  for (const chunk of chunks) {
    if (signal.aborted) {
      return;
    }
    await abortableDelay(chunkMs, signal);
    if (signal.aborted) {
      return;
    }
    yield chunk;
  }
}

const emptyUsage = {
  inputTokens: {
    total: 0,
    noCache: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 0,
    text: 0,
    reasoning: 0,
  },
} as const;

export function createMockLanguageModel(
  fixedText = 'Respuesta simulada de la demo BeerJS.',
): LanguageModel {
  return new MockLanguageModelV4({
    provider: 'beerjs-mock',
    modelId: 'mock-demo',
    doGenerate: {
      content: [{ type: 'text', text: fixedText }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: emptyUsage,
      warnings: [],
    },
    doStream: {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'text-start', id: 'mock-text' });
          controller.enqueue({
            type: 'text-delta',
            id: 'mock-text',
            delta: fixedText,
          });
          controller.enqueue({ type: 'text-end', id: 'mock-text' });
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: emptyUsage,
          });
          controller.close();
        },
      }),
    },
  });
}
