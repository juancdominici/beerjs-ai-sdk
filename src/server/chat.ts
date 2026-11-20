import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  safeValidateUIMessages,
} from 'ai';
import type { DemoDependencies, DemoEnv, DemoUIMessage, HistoryTurn } from '../shared/contracts.ts';
import {
  CHAT_BODY_LIMIT_BYTES,
  CHAT_HISTORY_LIMIT,
  CHAT_INPUT_MAX_CHARS,
  createFlowStatusId,
  createRoutePartId,
  flowStatusDataSchema,
  resolveFlowMode,
  routeDecisionSchema,
  resolveDemoConfig,
  getMessageText,
} from '../shared/contracts.ts';
import { handleStartersRequest } from './starters.ts';
import { createDecideRoute } from './router.ts';
import { createGetModel } from './models.ts';
import { nodeRegistry } from './nodes.ts';
import { practiceActionSchema, practiceProgressSchema, type PracticeAction } from '../shared/practice.ts';
import { gradeAnswers, latestPracticeContext, practiceTools } from './practice.ts';

export async function handleApiRequest(request: Request, env: DemoEnv): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === 'GET' && pathname === '/api/starters') {
    return handleStartersRequest(request, env);
  }
  if (request.method === 'POST' && pathname === '/api/chat') {
    return handleChatRequest(request, env);
  }
  return new Response(null, { status: 404 });
}

export class ChatRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ChatRequestError';
    this.status = status;
  }
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }
  return false;
}

function toHistoryTurn(message: DemoUIMessage): HistoryTurn | null {
  if (message.role !== 'user' && message.role !== 'assistant') {
    return null;
  }
  const text = getMessageText(message).trim();
  if (!text) {
    return null;
  }
  return { role: message.role, text };
}

/**
 * Validate and normalize the chat request body.
 * Rejects system roles from the client, empty last user text, and oversized input.
 */
export async function parseChatRequest(
  request: Request,
): Promise<{ messages: DemoUIMessage[]; practiceAction?: PracticeAction }> {
  const raw = await request.text();
  const byteLength = new TextEncoder().encode(raw).byteLength;
  if (byteLength > CHAT_BODY_LIMIT_BYTES) {
    throw new ChatRequestError(
      `Body supera el límite de ${CHAT_BODY_LIMIT_BYTES} bytes.`,
      413,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new ChatRequestError('JSON inválido.', 400);
  }

  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('messages' in parsed)
  ) {
    throw new ChatRequestError('Se requiere un array messages.', 400);
  }

  const validated = await safeValidateUIMessages<DemoUIMessage>({
    messages: (parsed as { messages: unknown }).messages,
    dataSchemas: {
      'flow-status': flowStatusDataSchema,
      route: routeDecisionSchema,
      'practice-progress': practiceProgressSchema,
    },
    tools: practiceTools,
  });

  if (!validated.success) {
    throw new ChatRequestError(
      validated.error.message || 'Mensajes inválidos.',
      400,
    );
  }

  const messages = validated.data;

  if (messages.some((message) => message.role === 'system')) {
    throw new ChatRequestError(
      'No se aceptan mensajes con rol system desde el cliente.',
      400,
    );
  }

  if (messages.length === 0) {
    throw new ChatRequestError('Se requiere al menos un mensaje de usuario.', 400);
  }

  const last = messages[messages.length - 1]!;
  if (last.role !== 'user') {
    throw new ChatRequestError(
      'El último mensaje debe ser del usuario.',
      400,
    );
  }

  const latestUserText = getMessageText(last).trim();
  if (!latestUserText) {
    throw new ChatRequestError(
      'El último mensaje de usuario debe tener texto no vacío.',
      400,
    );
  }

  if (latestUserText.length > CHAT_INPUT_MAX_CHARS) {
    throw new ChatRequestError(
      `El texto supera el máximo de ${CHAT_INPUT_MAX_CHARS} caracteres.`,
      400,
    );
  }

  const windowed =
    messages.length > CHAT_HISTORY_LIMIT
      ? messages.slice(-CHAT_HISTORY_LIMIT)
      : messages;

  let practiceAction: PracticeAction | undefined;
  if ('practiceAction' in parsed && parsed.practiceAction !== undefined) {
    const action = practiceActionSchema.safeParse(parsed.practiceAction);
    if (!action.success) throw new ChatRequestError('Acción de práctica inválida.', 400);
    try { gradeAnswers(action.data.input); } catch (error) {
      throw new ChatRequestError(error instanceof Error ? error.message : 'Intento de práctica inválido.', 400);
    }
    practiceAction = action.data;
  }
  return { messages: windowed, practiceAction };
}

export type ChatTurnInput = {
  messages: DemoUIMessage[];
  deps: DemoDependencies;
  signal: AbortSignal;
  practiceAction?: PracticeAction;
};

/**
 * Build the official UI Message Stream for one turn.
 * Emits flow-status and route before text; single assistant start/finish.
 */
export function createChatTurnStream({
  messages,
  deps,
  signal,
  practiceAction,
}: ChatTurnInput): ReadableStream {
  const mode = resolveFlowMode(deps.config);
  const turnId = generateId();
  const flowId = createFlowStatusId(turnId);
  const routeId = createRoutePartId(turnId);
  const textId = `text:${turnId}`;

  const last = messages[messages.length - 1]!;
  const latestUserText = getMessageText(last).trim();
  const history: HistoryTurn[] = [];
  for (const message of messages.slice(0, -1)) {
    const turn = toHistoryTurn(message);
    if (turn) {
      history.push(turn);
    }
  }

  return createUIMessageStream<DemoUIMessage>({
    originalMessages: messages,
    execute: async ({ writer }) => {
      writer.write({ type: 'start' });

      writer.write({
        type: 'data-flow-status',
        id: flowId,
        data: { stage: 'routing', mode },
      });

      if (signal.aborted) {
        writer.write({ type: 'abort' });
        writer.setOutcome({ status: 'aborted' });
        return;
      }

      let decision;
      try {
        decision = practiceAction ? {
          route: 'academico' as const, source: 'policy' as const, reason: 'classified' as const,
        } : await deps.decideRoute(
          { latestUserText, history, hasCompletedPractice: Boolean(latestPracticeContext(messages)) },
          signal,
        );
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          writer.write({ type: 'abort' });
          writer.setOutcome({ status: 'aborted' });
          return;
        }
        throw error;
      }

      if (signal.aborted) {
        writer.write({ type: 'abort' });
        writer.setOutcome({ status: 'aborted' });
        return;
      }

      writer.write({
        type: 'data-route',
        id: routeId,
        data: { route: decision.route, source: decision.source, reason: decision.reason, confidence: decision.confidence },
      });

      writer.write({
        type: 'data-flow-status',
        id: flowId,
        data: { stage: 'responding', mode },
      });

      const handler = nodeRegistry[decision.route];
      let textStream;
      let toolStream;
      try {
        ({ textStream, toolStream } = await handler({
          context: {
            latestUserText,
            history,
            messages,
            practiceAction,
          },
          decision,
          signal,
          deps,
        }));
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          writer.write({ type: 'abort' });
          writer.setOutcome({ status: 'aborted' });
          return;
        }
        writer.write({
          type: 'error',
          errorText:
            error instanceof Error
              ? error.message
              : 'Error al ejecutar el nodo.',
        });
        writer.setOutcome({ status: 'failed', error });
        writer.write({ type: 'finish', finishReason: 'error' });
        return;
      }

      try {
        let startedText = false;
        try {
          for await (const delta of textStream) {
            if (signal.aborted) break;
            if (!delta) continue;
            if (!startedText) {
              writer.write({ type: 'text-start', id: textId });
              startedText = true;
            }
            writer.write({ type: 'text-delta', id: textId, delta });
          }
        } finally {
          if (startedText) writer.write({ type: 'text-end', id: textId });
        }
        if (toolStream && !signal.aborted) {
          for await (const chunk of toolStream) {
            if (signal.aborted) break;
            writer.write(chunk);
            if (chunk.type === 'tool-output-error') {
              writer.write({ type: 'finish', finishReason: 'error' });
              writer.setOutcome({ status: 'failed', error: new Error(chunk.errorText) });
              return;
            }
          }
        }
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          writer.write({ type: 'abort' });
          writer.setOutcome({ status: 'aborted' });
          return;
        }
        writer.write({
          type: 'error',
          errorText:
            error instanceof Error
              ? error.message
              : 'Error durante la generación.',
        });
        writer.setOutcome({ status: 'failed', error });
        writer.write({ type: 'finish', finishReason: 'error' });
        return;
      }

      if (signal.aborted) {
        writer.write({ type: 'abort' });
        writer.setOutcome({ status: 'aborted' });
        return;
      }

      writer.write({
        type: 'data-flow-status',
        id: flowId,
        data: { stage: 'done', mode },
      });
      writer.write({ type: 'finish', finishReason: 'stop' });
      writer.setOutcome({ status: 'completed' });
    },
    onError: (error) =>
      error instanceof Error ? error.message : 'Error en el stream.',
  });
}

function createDemoRuntime(env: DemoEnv, fetchImpl: typeof fetch): DemoDependencies {
  const config = resolveDemoConfig(env);
  return {
    config,
    decideRoute: createDecideRoute(config, fetchImpl),
    getModel: createGetModel(config, fetchImpl),
  };
}

export type HandleChatOptions = {
  /** Override runtime deps (tests). */
  deps?: DemoDependencies;
  fetch?: typeof fetch;
};

/**
 * POST /api/chat — validate, route, stream one assistant turn.
 */
export async function handleChatRequest(
  request: Request,
  env: DemoEnv,
  options: HandleChatOptions = {},
): Promise<Response> {
  const deps = options.deps ?? createDemoRuntime(env, options.fetch ?? globalThis.fetch);

  let messages: DemoUIMessage[];
  let practiceAction: PracticeAction | undefined;
  try {
    ({ messages, practiceAction } = await parseChatRequest(request));
  } catch (error) {
    if (error instanceof ChatRequestError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }

  const stream = createChatTurnStream({
    messages,
    deps,
    signal: request.signal,
    practiceAction,
  });

  return createUIMessageStreamResponse({ stream });
}
