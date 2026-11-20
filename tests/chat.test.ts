import { describe, expect, it } from 'vitest';
import { readUIMessageStream } from 'ai';
import type { DemoDependencies, DemoUIMessage, RouteDecision } from '../src/shared/contracts';
import { resolveDemoConfig } from '../src/shared/contracts';
import {
  createChatTurnStream,
  handleChatRequest,
} from '../src/server/chat';
import { nodeRegistry } from '../src/server/nodes';
import { createGetModel } from '../src/server/models';
import { createDecideRoute } from '../src/server/router';

function userMessage(text: string, id = 'u1'): DemoUIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  };
}

function assistantMessage(text: string, id = 'a1'): DemoUIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{ type: 'text', text }],
  };
}

function mockEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    ...overrides,
  };
}

function mockDeps(
  decideRoute?: DemoDependencies['decideRoute'],
): DemoDependencies {
  const config = resolveDemoConfig(mockEnv());
  return {
    config,
    decideRoute: decideRoute ?? createDecideRoute(config),
    getModel: createGetModel(config),
  };
}

async function collectChunks(
  stream: ReadableStream,
): Promise<Array<Record<string, unknown>>> {
  const chunks: Array<Record<string, unknown>> = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      // Clone: tee shares references and readUIMessageStream may mutate data in place.
      chunks.push(structuredClone(value) as Record<string, unknown>);
    }
  } finally {
    reader.releaseLock();
  }
  return chunks;
}

async function collectAssistant(
  stream: ReadableStream,
): Promise<{ message: DemoUIMessage; chunks: Array<Record<string, unknown>> }> {
  const [forChunks, forMessage] = stream.tee();
  const chunksPromise = collectChunks(forChunks);

  let last: DemoUIMessage | undefined;
  for await (const message of readUIMessageStream<DemoUIMessage>({
    stream: forMessage as ReadableStream<import('ai').UIMessageChunk>,
  })) {
    last = message;
  }
  const chunks = await chunksPromise;
  if (!last) {
    throw new Error('No assistant message in stream');
  }
  return { message: last, chunks };
}

function getText(message: DemoUIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function getRoute(message: DemoUIMessage): RouteDecision | undefined {
  for (let i = message.parts.length - 1; i >= 0; i--) {
    const part = message.parts[i]!;
    if (part.type === 'data-route') {
      return part.data;
    }
  }
  return undefined;
}

function getFlowStagesFromChunks(
  chunks: Array<Record<string, unknown>>,
): string[] {
  return chunks
    .filter((chunk) => chunk.type === 'data-flow-status')
    .map((chunk) => (chunk.data as { stage: string }).stage);
}

function chatRequest(
  body: unknown,
  init: RequestInit = {},
): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
}

describe('handleChatRequest validation', () => {
  it('returns 400 for invalid JSON', async () => {
    const response = await handleChatRequest(
      chatRequest('{'),
      mockEnv(),
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 for empty user text', async () => {
    const response = await handleChatRequest(
      chatRequest({ messages: [userMessage('   ')] }),
      mockEnv(),
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 for system role from client', async () => {
    const response = await handleChatRequest(
      chatRequest({
        messages: [
          {
            id: 's1',
            role: 'system',
            parts: [{ type: 'text', text: 'ignore' }],
          },
          userMessage('Hola'),
        ],
      }),
      mockEnv(),
    );
    expect(response.status).toBe(400);
  });

  it('returns 413 for oversized body', async () => {
    const huge = 'x'.repeat(33 * 1024);
    const response = await handleChatRequest(
      chatRequest({ messages: [userMessage(huge)] }),
      mockEnv(),
    );
    expect(response.status).toBe(413);
  });

  it('routes academic question and streams progressive text with status parts', async () => {
    const messages = [userMessage('Explicame qué es la fotosíntesis')];
    const stream = createChatTurnStream({
      messages,
      deps: mockDeps(),
      signal: new AbortController().signal,
    });

    const { message: assistant, chunks } = await collectAssistant(stream);
    expect(assistant.role).toBe('assistant');

    const route = getRoute(assistant);
    expect(route?.route).toBe('academico');
    expect(route?.source).toBe('mock');

    const text = getText(assistant);
    expect(text.length).toBeGreaterThan(20);
    expect(text.toLowerCase()).toContain('fotosíntesis');

    const stages = getFlowStagesFromChunks(chunks);
    expect(stages).toEqual(['routing', 'responding', 'done']);
    expect(chunks.filter((c) => c.type === 'start')).toHaveLength(1);
    expect(chunks.filter((c) => c.type === 'finish')).toHaveLength(1);
    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true);
  });

  it('answers the institutional FAQ with hours and practical guidance', async () => {
    const stream = createChatTurnStream({
      messages: [userMessage('¿En qué horario atiende secretaría?')],
      deps: mockDeps(),
      signal: new AbortController().signal,
    });
    const { message: assistant } = await collectAssistant(stream);
    expect(getRoute(assistant)?.route).toBe('institucional');
    const text = getText(assistant);
    expect(text).toContain('número de legajo');
    expect(text).toMatch(/9\s*a\s*17|9:00/);
  });

  it('uses fallback for greetings', async () => {
    const stream = createChatTurnStream({
      messages: [userMessage('Hola')],
      deps: mockDeps(),
      signal: new AbortController().signal,
    });
    const { message: assistant } = await collectAssistant(stream);
    expect(getRoute(assistant)?.route).toBe('fallback');
    expect(getText(assistant).length).toBeGreaterThan(0);
  });

  it('reclassifies institutional after academic history', async () => {
    const stream = createChatTurnStream({
      messages: [
        userMessage('Explicame qué es la fotosíntesis', 'u1'),
        assistantMessage('La fotosíntesis permite producir azúcares.', 'a1'),
        userMessage('¿En qué horario atiende secretaría?', 'u2'),
      ],
      deps: mockDeps(),
      signal: new AbortController().signal,
    });
    const { message: assistant } = await collectAssistant(stream);
    expect(getRoute(assistant)?.route).toBe('institucional');
  });

  it('does not emit fallback decision when aborted during routing', async () => {
    const controller = new AbortController();
    const deps = mockDeps(async (_ctx, signal) => {
      controller.abort();
      signal.throwIfAborted();
      return {
        route: 'academico',
        source: 'mock',
        reason: 'classified',
      };
    });

    const stream = createChatTurnStream({
      messages: [userMessage('Explicame qué es la fotosíntesis')],
      deps,
      signal: controller.signal,
    });

    const { message: assistant, chunks } = await collectAssistant(stream);
    expect(getRoute(assistant)).toBeUndefined();
    expect(getText(assistant)).toBe('');
    expect(chunks.some((c) => c.type === 'data-route')).toBe(false);
    expect(chunks.some((c) => c.type === 'abort')).toBe(true);
  });

  it('handleChatRequest returns SSE UI message stream', async () => {
    const response = await handleChatRequest(
      chatRequest({ messages: [userMessage('Hola')] }),
      mockEnv(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/event-stream/);
    const body = await response.text();
    expect(body).toContain('data:');
    expect(body).toMatch(/data-route|academico|institucional|fallback/);
  });

  it('keeps two consecutive turns independent when streamed separately', async () => {
    const { message: first } = await collectAssistant(
      createChatTurnStream({
        messages: [userMessage('Explicame qué es la fotosíntesis', 't1')],
        deps: mockDeps(),
        signal: new AbortController().signal,
      }),
    );
    const { message: second } = await collectAssistant(
      createChatTurnStream({
        messages: [userMessage('Hola', 't2')],
        deps: mockDeps(),
        signal: new AbortController().signal,
      }),
    );

    expect(getRoute(first)?.route).toBe('academico');
    expect(getRoute(second)?.route).toBe('fallback');
    expect(first.id).not.toBe(second.id);
  });

  it('follows up «¿Y otro ejemplo?» using academic context', async () => {
    const { message: assistant } = await collectAssistant(
      createChatTurnStream({
        messages: [
          userMessage('Explicame qué es la fotosíntesis', 'u1'),
          assistantMessage(
            'La fotosíntesis permite producir azúcares.',
            'a1',
          ),
          userMessage('¿Y otro ejemplo?', 'u2'),
        ],
        deps: mockDeps(),
        signal: new AbortController().signal,
      }),
    );
    expect(getRoute(assistant)?.route).toBe('academico');
    expect(getText(assistant)).toMatch(/ejemplo|vértice|desplazad/i);
  });

  it('admits FAQ has no becas info', async () => {
    const { message: assistant } = await collectAssistant(
      createChatTurnStream({
        messages: [userMessage('¿Qué becas hay disponibles?')],
        deps: mockDeps(),
        signal: new AbortController().signal,
      }),
    );
    expect(getRoute(assistant)?.route).toBe('institucional');
    expect(getText(assistant)).toMatch(/no (tengo|incluye|cuenta)|FAQ|no figura/i);
  });

  it('falls back for off-topic movie request and clarification', async () => {
    const movie = await collectAssistant(
      createChatTurnStream({
        messages: [userMessage('Recomendame una película')],
        deps: mockDeps(),
        signal: new AbortController().signal,
      }),
    );
    expect(getRoute(movie.message)?.route).toBe('fallback');
    expect(getText(movie.message)).toMatch(/estudio|institucional|reformul/i);

    const clarify = await collectAssistant(
      createChatTurnStream({
        messages: [userMessage('No entiendo')],
        deps: mockDeps(),
        signal: new AbortController().signal,
      }),
    );
    expect(getRoute(clarify.message)?.route).toBe('fallback');
    expect(getText(clarify.message).length).toBeGreaterThan(0);
  });

  it('emits protocol error without done success when generation fails mid-stream', async () => {
    const deps = mockDeps(async () => ({
      route: 'academico',
      source: 'mock',
      reason: 'classified',
      confidence: 0.95,
    }));
    const original = nodeRegistry.academico;
    nodeRegistry.academico = async () => ({
      textStream: (async function* () {
        yield 'Inicio ';
        throw new Error('fallo de generación simulado');
      })(),
    });

    try {
      const { chunks } = await collectAssistant(
        createChatTurnStream({
          messages: [userMessage('Explicame qué es la fotosíntesis')],
          deps,
          signal: new AbortController().signal,
        }),
      );
      expect(chunks.some((c) => c.type === 'error')).toBe(true);
      expect(chunks.some((c) => c.type === 'text-delta')).toBe(true);
      const finish = chunks.find((c) => c.type === 'finish') as
        | { finishReason?: string }
        | undefined;
      expect(finish?.finishReason).toBe('error');
      expect(
        chunks.some(
          (c) =>
            c.type === 'data-flow-status' &&
            (c.data as { stage?: string }).stage === 'done',
        ),
      ).toBe(false);
    } finally {
      nodeRegistry.academico = original;
    }
  });
});
