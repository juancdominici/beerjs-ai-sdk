import { checkPracticeAnswer } from '../src/server/practice';
import { describe, expect, it, vi } from 'vitest';
import type { LanguageModel } from 'ai';
import { handleChatRequest } from '../src/server/chat';
import { createDecideRoute } from '../src/server/router';
import { resolveDemoConfig } from '../src/shared/contracts';
import {
  createGetModel,
  createMockLanguageModel,
  createProgressiveTextStream,
} from '../src/server/models';

describe('createGetModel', () => {
  it('returns a mock LanguageModel in mock mode', () => {
    const getModel = createGetModel(resolveDemoConfig({}));
    const model = getModel();
    expect(model).toBeDefined();
    expect(
      typeof model === 'object' &&
        model !== null &&
        'specificationVersion' in model,
    ).toBe(true);
  });

});

describe('createMockLanguageModel', () => {
  it('exposes LanguageModelV4 shape without network', () => {
    const model = createMockLanguageModel('hola') as Extract<
      LanguageModel,
      { specificationVersion: 'v4' }
    >;
    expect(model.specificationVersion).toBe('v4');
    expect(model.provider).toBe('beerjs-mock');
  });
});

describe('createProgressiveTextStream', () => {
  it('yields progressive chunks', async () => {
    const chunks: string[] = [];
    for await (const chunk of createProgressiveTextStream(
      'abcdefghijklmnop',
      new AbortController().signal,
      0,
      4,
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['abcd', 'efgh', 'ijkl', 'mnop']);
  });

  it('stops on abort without hanging', async () => {
    const controller = new AbortController();
    const chunks: string[] = [];
    for await (const chunk of createProgressiveTextStream(
      'one two three four five six',
      controller.signal,
      20,
      4,
    )) {
      chunks.push(chunk);
      controller.abort();
    }
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.join('').length).toBeLessThan('one two three four five six'.length);
  });
});

function responsesStream(delta: string): Response {
  const events = [
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1' } },
    { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, delta },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_1' } },
    { type: 'response.completed', response: {} },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('ChatGPT plan usage with intercepted HTTP', () => {
  it.each([[1, 1], [10, 5], [null, 5]])('applies the server limit to the model count %s', async (count, expected) => {
    const upstream: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const evidence = JSON.parse(body.input.at(-1).content[0].text);
      expect(evidence.history).toEqual([{ role: 'user', text: 'Explicame las clausuras' }]);
      return responsesStream(JSON.stringify({ route: 'academico', intent: 'new-practice', practice: { count, topic: 'clausuras' } }));
    };
    const decide = createDecideRoute({ chatgptToken: 'plan-token' }, upstream);
    const decision = await decide({
      latestUserText: 'Quiero practicar', history: [{ role: 'user', text: 'Explicame las clausuras' }],
    }, new AbortController().signal);
    expect(decision.practice).toEqual({ count: expected, topic: 'clausuras' });
  });

  it('asks for a topic, streams two unique questions as they arrive, and grades with the private key', async () => {
    const question = (statement: string) => ({
      statement,
      objective: statement === second ? 'usos de las clausuras' : 'captura del entorno léxico',
      options: ['Primera', 'Segunda', 'Tercera'].map((text, j) => ({ text, correct: j === 1 })),
      justification: 'Justificación privada',
      incorrectFeedback: 'Pista privada',
    });
    const first = '¿Qué captura una clausura?';
    const second = '¿Cuándo resulta útil una clausura?';
    let generated = 0;
    let releaseSecond!: () => void;
    const waitForReader = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const upstream = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const properties = body.text.format.schema.properties;
      const context = JSON.parse(body.input.at(-1).content[0].text);
      if (properties.route) {
        if (context.latestUserText === 'Sobre clausuras') {
          expect(context.history.map(({ text }: { text: string }) => text)).toEqual([
            'Haceme dos preguntas', '¿Sobre qué tema querés practicar?',
          ]);
        }
        const topic = context.latestUserText === 'Sobre clausuras' ? 'Clausuras de JavaScript' : null;
        return responsesStream(JSON.stringify({ route: 'academico', intent: 'new-practice', practice: { topic, count: 2 } }));
      }
      if (properties.statement) {
        expect(context.topic).toBe('Clausuras de JavaScript');
        expect(context.previous.map(({ statement }: { statement: string }) => statement)).toEqual(generated ? [first] : []);
        generated++;
        if (generated === 2) await waitForReader;
        const candidate = [first, 'QUE CAPTURA UNA CLAUSURA!', '¿Qué datos conserva una función cerrada?', second][generated - 1]!;
        return responsesStream(JSON.stringify(question(candidate)));
      }
      expect(context.questions).toMatchObject([{
        questionId: 'q1', statement: first, correctOptionIds: ['b'], verdict: 'correct',
      }]);
      return responsesStream(JSON.stringify({ questions: [{ questionId: 'q1', eval: 'Feedback generado' }], closing: '¡Muy bien! Podemos retomar la pregunta pendiente.' }));
    });
    const message = (id: string, text: string, role = 'user') => ({ id, role, parts: [{ type: 'text', text }] });
    const request = (messages: ReturnType<typeof message>[], practiceAction?: import('../src/shared/practice').PracticeAction) =>
      handleChatRequest(new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ messages, practiceAction }) }),
        { CHATGPT_ACCESS_TOKEN: 'plan-token' }, { fetch: upstream });
    const events = (text: string) => text.split('\n').filter((line) => line.startsWith('data: {')).map((line) => JSON.parse(line.slice(6)));
    const output = (text: string) => events(text).find((part) => part.type === 'tool-output-available').output;

    const initial = message('u1', 'Haceme dos preguntas');
    const clarification = events(await (await request([initial])).text());
    expect(clarification.filter((part) => part.type === 'text-delta').map((part) => part.delta).join('')).toBe('¿Sobre qué tema querés practicar?');
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(clarification.some((part) => part.type === 'tool-input-available')).toBe(false);

    const response = await request([initial, message('a1', '¿Sobre qué tema querés practicar?', 'assistant'), message('u2', 'Sobre clausuras')]);
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let stream = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        stream += value;
        if (stream.includes('data-practice-progress') && stream.includes(first)) releaseSecond();
      }
    } finally { releaseSecond(); reader.releaseLock(); }
    expect(events(stream).find((part) => part.type === 'data-practice-progress').data).toMatchObject({ total: 2, questions: [{ statement: first }] });
    const quiz = output(stream);
    expect(quiz.questions.map(({ statement }: { statement: string }) => statement)).toEqual([first, second]);
    for (const secret of ['correctOptionIds', '"correct":', 'justification', 'incorrectFeedback', 'objective', 'privada']) expect(stream).not.toContain(secret);
    const input = { quizId: quiz.quizId, attemptId: quiz.attemptId, answers: [{ questionId: 'q1', selectedOptionIds: ['b'] }] };
    const gradedStream = await (await request([message('u3', 'Comprobar')], { type: 'check-practice', input })).text();
    const result = output(gradedStream);
    expect(result).not.toHaveProperty('closing');
    const gradedEvents = events(gradedStream);
    const cardIndex = gradedEvents.findIndex((part) => part.type === 'tool-output-available');
    expect(gradedEvents.slice(cardIndex + 1).filter((part) => part.type === 'text-delta').map((part) => part.delta).join(''))
      .toBe('¡Muy bien! Podemos retomar la pregunta pendiente.');
    expect(result.summary).toEqual({ total: 2, answered: 1, correct: 1 });
    expect(result.results[0]).toMatchObject({ verdict: 'correct', eval: 'Feedback generado' });
    const missing = await request([message('u4', 'Comprobar')], { type: 'check-practice', input: { ...input, attemptId: 'missing' } });
    expect(missing.status).toBe(400);
    expect(upstream).toHaveBeenCalledTimes(7);
  });

  it.each([
    ['explanation', 'Explicación de Luna'],
    ['grade', 'Feedback de Luna'],
    ['review', 'Revisemos las respuestas'],
  ])('routes and streams with GPT-6 Luna through Responses (%s)', async (kind, expectedText) => {
    const practice = kind === 'grade';
    const review = kind === 'review';
    const attempt = { quizId: 'biology-v1', attemptId: 'plan-test', answers: [{ questionId: 'q1', selectedOptionIds: ['b'] }] } satisfies import('../src/shared/practice').CheckPracticeInput;
    const graded = checkPracticeAnswer(attempt);
    const upstream = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.openai.com/v1/responses');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer plan-token');
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model: 'gpt-6-luna', stream: true, store: false, input: expect.any(Array) });
      expect(body).not.toHaveProperty('max_output_tokens');
      if (practice) expect(body.text?.format?.type).toBe('json_schema');
      const classification = body.text?.format?.schema?.properties?.route;
      if (review && classification) {
        const evidence = JSON.parse(body.input.at(-1).content[0].text);
        expect(evidence.hasCompletedPractice).toBe(true);
        expect(evidence.latestUserText).toBe('Dale, repasemos');
      }
      if (review && !classification) {
        const evidence = JSON.parse(body.input.at(-1).content[0].text);
        expect(evidence.latestPracticeAttempt).toMatchObject({
          quizId: 'biology-v1', attemptId: 'plan-test',
          questions: [{ questionId: 'q1', statement: expect.any(String), selectedOptionIds: ['b'], verdict: 'incorrect' }],
        });
        expect(JSON.stringify(evidence)).not.toContain('feedback inventado');
      }
      const delta = classification
        ? JSON.stringify({ route: 'academico', intent: review ? 'review' : 'answer',
          practice: review ? { topic: 'biología', count: 5 } : null })
        : practice
          ? JSON.stringify({ questions: [{ questionId: 'q1', eval: expectedText }], closing: 'Repasemos la pregunta 1: el ADN se encuentra principalmente en el núcleo.' })
          : expectedText;
      return responsesStream(delta);
    });
    const response = await handleChatRequest(new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          ...(review ? [{
            id: 'prior', role: 'assistant', parts: [{
              type: 'tool-checkPracticeAnswer', toolCallId: 'graded-1', state: 'output-available',
              input: attempt,
              output: { ...graded, results: graded.results.map((result) => ({
                ...result, verdict: 'correct', eval: 'feedback inventado',
              })) },
            }, { type: 'text', text: 'Si querés, podemos repasar las preguntas que te costaron.' }],
          }] : []),
          { id: 'u1', role: 'user', parts: [{ type: 'text', text: review
            ? 'Dale, repasemos'
            : '¿Qué es una clausura en JavaScript?' }] },
        ],
        ...(practice && { practiceAction: { type: 'check-practice', input: attempt } }),
      }),
    }), { CHATGPT_ACCESS_TOKEN: 'plan-token' }, { fetch: upstream });

    const stream = await response.text();
    expect(stream).toContain(`"source":"${practice ? 'policy' : 'chatgpt'}"`);
    expect(stream).toContain('"mode":"chatgpt"');
    expect(stream).toContain(expectedText);
    if (review) expect(stream).not.toContain('createPracticeQuestion');
    expect(stream).not.toMatch(/plan-token|platform-key/);
    expect(upstream).toHaveBeenCalledTimes(practice ? 1 : 2);
  });
});
