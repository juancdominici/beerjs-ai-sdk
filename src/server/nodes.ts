import { streamText, type LanguageModel } from 'ai';
import type { HistoryTurn, NodeHandler, NodeRegistry, Route, Starters } from '../shared/contracts.ts';
import { resolveAcademicReply, resolveFallbackReply, resolveInstitutionalReply } from './fixtures.ts';
import { latestPracticeContext, streamPracticeTool } from './practice.ts';
import { createProgressiveTextStream } from './models.ts';

import { PRACTICE_TOPIC_PROMPT } from './router.ts';

export const academicoNode: NodeHandler = async ({ context, decision, signal, deps }) => {
  const connected = Boolean(deps.config.chatgptToken);
  const practice = context.practiceAction ? undefined : latestPracticeContext(context.messages);
  if (!context.practiceAction && decision.practice?.topic === null) {
    return { textStream: createProgressiveTextStream(PRACTICE_TOPIC_PROMPT, signal) };
  }
  if (context.practiceAction || decision.practice) {
    return {
      textStream: createProgressiveTextStream(context.practiceAction
        ? ''
        : 'Respondé las preguntas y comprobá el intento. Podés dejar preguntas sin responder.', signal),
      toolStream: streamPracticeTool(context.practiceAction, signal, connected ? deps.getModel() : undefined, decision.practice),
    };
  }
  if (connected) {
    return {
      textStream: streamAcademicReply(
        context.latestUserText,
        context.history,
        practice,
        deps.getModel(),
        signal,
      ),
    };
  }
  const review = decision.review ? practice?.questions.filter(({ verdict }) => verdict !== 'correct') : undefined;
  const text = review
    ? review.length
      ? ['Repasemos las preguntas que te costaron:', ...review.map(({ number, justification }) => '- **Pregunta ' + number + ':** ' + justification)].join('\n')
      : 'No quedaron respuestas incorrectas para revisar. Si querés, contame qué concepto te gustaría repasar.'
    : resolveAcademicReply(context.latestUserText, context.history);

  return {
    textStream: createProgressiveTextStream(text, signal),
  };
};

async function* streamAcademicReply(
  question: string,
  history: HistoryTurn[],
  practice: ReturnType<typeof latestPracticeContext>,
  model: LanguageModel,
  signal: AbortSignal,
) {
  try {
    const result = streamText({
      model,
      instructions: [
        'Sos un tutor. Respondé en español con una explicación breve y un ejemplo cuando sea útil.',
        'Si el usuario acepta repasar o pide revisar su intento, retomá las preguntas incorrectas o parciales por su número y explicá el concepto en base a la corrección provista. No generes un cuestionario nuevo ni confundas preguntas no contestadas con errores.',
      ].join(' '),
      messages: [
        ...history.map(({ role, text }) => ({ role, content: text })),
        { role: 'user', content: practice ? JSON.stringify({ question, latestPracticeAttempt: practice }) : question },
      ],
      abortSignal: signal,
      reasoning: 'none',
      maxOutputTokens: 800,
      maxRetries: 0,
      onError: () => {},
    });
    for await (const part of result.fullStream) {
      if (part.type === 'error') throw part.error;
      if (part.type === 'text-delta') yield part.text;
    }
  } catch {
    if (!signal.aborted) throw new Error('No se pudo generar la respuesta con ChatGPT.');
  }
}

export const institucionalNode: NodeHandler = async ({ context, signal }) => {
  const text = resolveInstitutionalReply(context.latestUserText);

  return {
    textStream: createProgressiveTextStream(text, signal),
  };
};

export const fallbackNode: NodeHandler = async ({
  context,
  decision,
  signal,
}) => {
  const text = resolveFallbackReply(context.latestUserText, decision.reason);

  return {
    textStream: createProgressiveTextStream(text, signal),
  };
};

export const nodeRegistry: NodeRegistry = {
  academico: academicoNode,
  institucional: institucionalNode,
  fallback: fallbackNode,
};

export const nodeCapabilities = {
  academico: {
    capabilities: 'Explicar temas de estudio y abrir una autoevaluación sobre el tema consultado.',
    example: { label: 'Quiero practicar', text: 'Quiero practicar biología con una autoevaluación' },
  },
  institucional: {
    capabilities: 'Responder consultas frecuentes de la institución ficticia, como el horario de secretaría.',
    example: { label: 'Horario de secretaría', text: '¿En qué horario atiende secretaría?' },
  },
  fallback: {
    capabilities: 'Responder saludos, orientar al usuario y pedir aclaraciones.',
    example: { label: 'Saludar', text: 'Hola, BeerJS Córdoba!' },
  },
} satisfies Record<Route, { capabilities: string; example: Starters[Route] }>;
