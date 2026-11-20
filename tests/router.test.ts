import { describe, expect, it } from 'vitest';
import { createDecideRoute } from '../src/server/router';
import type { RoutingContext } from '../src/shared/contracts';

function context(
  latestUserText: string,
  history: RoutingContext['history'] = [],
): RoutingContext {
  return { latestUserText, history };
}

describe('createDecideRoute · mock classifier', () => {
  const decide = createDecideRoute({});

  it('routes academic concepts to academico', async () => {
    const decision = await decide(
      context('Explicame qué es la fotosíntesis'),
      new AbortController().signal,
    );
    expect(decision.route).toBe('academico');
    expect(decision.source).toBe('mock');
    expect(decision.reason).toBe('classified');
  });

  it('routes academic follow-ups using history', async () => {
    const decision = await decide(
      context('¿Y otro ejemplo?', [
        { role: 'user', text: 'Explicame qué es la fotosíntesis' },
        { role: 'assistant', text: 'La fotosíntesis permite producir azúcares.' },
      ]),
      new AbortController().signal,
    );
    expect(decision.route).toBe('academico');
    expect(decision.source).toBe('mock');
  });

  it('routes secretaría / horarios / inscripción to institucional', async () => {
    for (const text of [
      '¿En qué horario atiende secretaría?',
      '¿Cómo hago la inscripción?',
      '¿Qué becas hay disponibles?',
    ]) {
      const decision = await decide(context(text), new AbortController().signal);
      expect(decision.route).toBe('institucional');
      expect(decision.source).toBe('mock');
    }
  });

  it('routes greetings and off-topic to fallback', async () => {
    for (const text of ['Hola', 'Recomendame una película', 'No entiendo']) {
      const decision = await decide(context(text), new AbortController().signal);
      expect(decision.route).toBe('fallback');
      expect(decision.source).toBe('mock');
      expect(decision.reason).toBe('out-of-scope');
    }
  });

  it('reclassifies institutional after academic history', async () => {
    const decision = await decide(
      context('¿En qué horario atiende secretaría?', [
        { role: 'user', text: 'Explicame qué es la fotosíntesis' },
        { role: 'assistant', text: 'Ocurre en los cloroplastos.' },
      ]),
      new AbortController().signal,
    );
    expect(decision.route).toBe('institucional');
    expect(decision.source).toBe('mock');
  });
});
