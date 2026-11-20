import { describe, expect, it } from 'vitest';
import type {
  DemoDependencies,
  RouteDecision,
  ValidatedTurnContext,
} from '../src/shared/contracts';
import { resolveDemoConfig } from '../src/shared/contracts';
import {
  resolveInstitutionalReply,
  academicFollowUpExampleReply,
  academicPhotosynthesisReply,
} from '../src/server/fixtures';
import { nodeRegistry } from '../src/server/nodes';
import { createGetModel } from '../src/server/models';

async function collectText(
  stream: AsyncIterable<string>,
): Promise<{ text: string; chunks: string[] }> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return { text: chunks.join(''), chunks };
}

function decision(
  route: RouteDecision['route'],
  reason: RouteDecision['reason'] = 'classified',
): RouteDecision {
  return {
    route,
    source: 'mock',
    reason,
    confidence: 0.95,
  };
}

function context(
  latestUserText: string,
  history: ValidatedTurnContext['history'] = [],
): ValidatedTurnContext {
  return {
    latestUserText,
    history,
    messages: [],
  };
}

function deps(): DemoDependencies {
  const config = resolveDemoConfig({});
  return {
    config,
    decideRoute: async () => decision('fallback', 'out-of-scope'),
    getModel: createGetModel(config),
  };
}

describe('nodeRegistry', () => {
  it('registers academico, institucional, and fallback', () => {
    expect(Object.keys(nodeRegistry).sort()).toEqual([
      'academico',
      'fallback',
      'institucional',
    ]);
    expect(typeof nodeRegistry.academico).toBe('function');
    expect(typeof nodeRegistry.institucional).toBe('function');
    expect(typeof nodeRegistry.fallback).toBe('function');
  });
});

describe('academico node', () => {
  it('streams progressive non-empty text for the photosynthesis example', async () => {
    const { textStream } = await nodeRegistry.academico({
      context: context('Explicame qué es la fotosíntesis'),
      decision: decision('academico'),
      signal: new AbortController().signal,
      deps: deps(),
    });

    const { text, chunks } = await collectText(textStream);
    expect(text.length).toBeGreaterThan(0);
    expect(chunks.length).toBeGreaterThan(1);
    expect(text).toBe(academicPhotosynthesisReply);
    expect(text).toMatch(/fotosíntesis/i);
  });

  it('uses history for the follow-up «¿Y otro ejemplo?»', async () => {
    const { textStream } = await nodeRegistry.academico({
      context: context('¿Y otro ejemplo?', [
        {
          role: 'user',
          text: 'Explicame qué es la fotosíntesis',
        },
        {
          role: 'assistant',
          text: academicPhotosynthesisReply,
        },
      ]),
      decision: decision('academico'),
      signal: new AbortController().signal,
      deps: deps(),
    });

    const { text } = await collectText(textStream);
    expect(text).toBe(academicFollowUpExampleReply);
    expect(text).toMatch(/Otro ejemplo|vértice/i);
  });
});

describe('institucional node', () => {
  it('returns hours and practical guidance for secretaría', async () => {
    const { textStream } = await nodeRegistry.institucional({
      context: context('¿En qué horario atiende secretaría?'),
      decision: decision('institucional'),
      signal: new AbortController().signal,
      deps: deps(),
    });

    const { text } = await collectText(textStream);
    expect(text).toMatch(/lunes a viernes/i);
    expect(text).toMatch(/9 a 17/);
    expect(text).toContain('constancias de alumno regular');
  });

  it('explains where to enroll, what to submit and how to track the request', () => {
    const text = resolveInstitutionalReply('¿Cómo hago la inscripción?');
    expect(text).toContain('Campus → Inscripciones');
    expect(text).toContain('adjuntá la documentación');
    expect(text).toContain('Mis inscripciones');
  });

  it('says FAQ has no becas info', async () => {
    const { textStream } = await nodeRegistry.institucional({
      context: context('¿Qué becas hay disponibles?'),
      decision: decision('institucional'),
      signal: new AbortController().signal,
      deps: deps(),
    });

    const { text } = await collectText(textStream);
    expect(text).toMatch(/No tengo esa información|FAQ/i);
    expect(text).toContain('cómo inscribirte desde el campus');
  });
});

describe('fallback node', () => {
  it('greets on hola', async () => {
    const { textStream } = await nodeRegistry.fallback({
      context: context('Hola'),
      decision: decision('fallback', 'out-of-scope'),
      signal: new AbortController().signal,
      deps: deps(),
    });

    const { text } = await collectText(textStream);
    expect(text).toContain('¡Un saludo para la gente de [BeerJS Córdoba](https://beerjscba.com/)!');
    expect(text).toMatch(/académicas|institucionales|estudio/i);
  });

  it('reformulates off-topic requests', async () => {
    const { textStream } = await nodeRegistry.fallback({
      context: context('Recomendame una película'),
      decision: decision('fallback', 'out-of-scope'),
      signal: new AbortController().signal,
      deps: deps(),
    });

    const { text } = await collectText(textStream);
    expect(text).toMatch(/fuera del alcance|reformular/i);
  });

  it('asks for clarification without context', async () => {
    const { textStream } = await nodeRegistry.fallback({
      context: context('No entiendo'),
      decision: decision('fallback', 'out-of-scope'),
      signal: new AbortController().signal,
      deps: deps(),
    });

    const { text } = await collectText(textStream);
    expect(text).toMatch(/contexto|académicas|institucional/i);
  });

  it('mentions router failure reason', async () => {
    const { textStream } = await nodeRegistry.fallback({
      context: context('algo'),
      decision: decision('fallback', 'router-unavailable'),
      signal: new AbortController().signal,
      deps: deps(),
    });

    const { text } = await collectText(textStream);
    expect(text).toContain('router-unavailable');
  });
});

describe('AbortSignal', () => {
  it('stops streaming without hanging', async () => {
    const controller = new AbortController();
    const { textStream } = await nodeRegistry.academico({
      context: context('Explicame qué es la fotosíntesis'),
      decision: decision('academico'),
      signal: controller.signal,
      deps: deps(),
    });

    const chunks: string[] = [];
    const iterate = (async () => {
      for await (const chunk of textStream) {
        chunks.push(chunk);
        if (chunks.length === 1) {
          controller.abort();
        }
      }
    })();

    await expect(iterate).resolves.toBeUndefined();
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.join('').length).toBeLessThan(academicPhotosynthesisReply.length);
  });
});
