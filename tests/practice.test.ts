import { describe, expect, it, vi } from 'vitest';
import { convertToModelMessages, readUIMessageStream } from 'ai';
import type { DemoUIMessage } from '../src/shared/contracts';
import type { CheckPracticeInput } from '../src/shared/practice';
import { createPracticeQuestion, checkPracticeAnswer, practiceTools } from '../src/server/practice';
import { fixtureEvaluation, validateEvaluation } from '../src/server/practice';
import { handleChatRequest } from '../src/server/chat';
import { streamPracticeTool } from '../src/server/practice';

const input = (answers: CheckPracticeInput['answers'] = []): CheckPracticeInput => ({
  quizId: 'biology-v1', attemptId: 'attempt-1', answers,
});

const env = {};

function request(messages: DemoUIMessage[], practiceInput?: CheckPracticeInput) {
  return new Request('http://localhost/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, ...(practiceInput ? {
      practiceAction: { type: 'check-practice', input: practiceInput },
    } : {}) }),
  });
}

async function parseSSE(response: Response, observe?: (message: DemoUIMessage) => void): Promise<DemoUIMessage> {
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const text = await response.text();
  const chunks = text.split('\n').filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice(6)));
  let last: DemoUIMessage | undefined;
  const stream = new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  } });
  for await (const message of readUIMessageStream<DemoUIMessage>({ stream })) {
    last = message;
    observe?.(message);
  }
  if (!last) throw new Error('Missing message');
  return last;
}

describe('practice tools', () => {
  it('returns five public questions with no answer key or justification', () => {
    const quiz = createPracticeQuestion('attempt-1');
    expect(quiz.quizId).toBe('biology-v1');
    expect(quiz.questions).toHaveLength(5);
    expect(quiz.questions[0]!.statement).toContain('ADN');
    const json = JSON.stringify(quiz);
    expect(json).not.toContain('correctOptionIds');
    expect(json).not.toContain('justification');
    expect(json).not.toContain('incorrectFeedback');
  });

  it('grades single, multiple, partial, incorrect and unanswered answers on the server', () => {
    const result = checkPracticeAnswer(input([
      { questionId: 'q1', selectedOptionIds: ['a'] },
      { questionId: 'q2', selectedOptionIds: ['a'] },
      { questionId: 'q3', selectedOptionIds: ['b'] },
    ]));
    expect(result.results.map((r) => r.verdict)).toEqual(['correct', 'incorrect', 'partial', 'unanswered', 'unanswered']);
    expect(result.summary).toEqual({ total: 5, answered: 3, correct: 1 });
    expect(result.results.filter((row) => row.eval).map((row) => row.questionId)).toEqual(['q1', 'q2', 'q3']);
    expect(result.results[3]!.eval).toBe('');
    expect(JSON.stringify(result)).not.toContain('correctOptionIds');
  });

  it('treats multiple answers as a set and rejects distractors', () => {
    expect(checkPracticeAnswer(input([{ questionId: 'q3', selectedOptionIds: ['b', 'a'] }])).results[2]!.verdict).toBe('correct');
    expect(checkPracticeAnswer(input([{ questionId: 'q3', selectedOptionIds: ['a', 'b', 'c'] }])).results[2]!.verdict).toBe('incorrect');
  });

  it.each([
    [{ questionId: 'unknown', selectedOptionIds: ['a'] }],
    [{ questionId: 'q1', selectedOptionIds: ['unknown'] }],
    [{ questionId: 'q1', selectedOptionIds: ['a', 'b'] }],
    [{ questionId: 'q3', selectedOptionIds: ['a', 'a'] }],
    [{ questionId: 'q1', selectedOptionIds: ['a'] }, { questionId: 'q1', selectedOptionIds: ['b'] }],
  ])('rejects invalid submissions: %j', (...answers) => {
    // it.each spreads the row's answer objects into the callback.
    expect(() => checkPracticeAnswer(input(answers))).toThrow();
  });

  it('supports an empty attempt without generating feedback for unanswered questions', () => {
    const result = checkPracticeAnswer(input());
    expect(result.summary.answered).toBe(0);
    expect(result.results.every((row) => row.eval === '')).toBe(true);
  });

  it('rejects missing, duplicate, unknown feedback IDs and unexpected fields', () => {
    for (const value of [
      { questions: [] },
      { questions: [{ questionId: 'q2', eval: 'Feedback' }] },
      { questions: [{ questionId: 'q1', eval: 'Feedback' }, { questionId: 'q1', eval: 'Feedback' }] },
      { questions: [{ questionId: 'q1', eval: 'Feedback', statement: 'Duplicated' }] },
    ]) expect(() => validateEvaluation(value, ['q1'])).toThrow();
    expect(fixtureEvaluation(checkPracticeAnswer(input()).results)).toEqual({ questions: [] });
  });

  it('does not finish a tool after cancellation', async () => {
    const controller = new AbortController();
    const stream = streamPracticeTool(undefined, controller.signal)[Symbol.asyncIterator]();
    expect((await stream.next()).value?.type).toBe('tool-input-available');
    controller.abort();
    expect((await stream.next()).done).toBe(true);
  });
});

describe('practice chat stream round trip', () => {
  it('reports a tool failure without claiming the flow completed successfully', async () => {
    const spy = vi.spyOn(practiceTools.createPracticeQuestion, 'execute').mockImplementationOnce(() => {
      throw new Error('Fallo de práctica controlado');
    });
    try {
      const user: DemoUIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Quiero practicar biología' }] };
      const message = await parseSSE(await handleChatRequest(request([user]), env));
      const part = message.parts.find((p) => p.type === 'tool-createPracticeQuestion');
      expect(part?.state).toBe('output-error');
      const status = message.parts.find((p) => p.type === 'data-flow-status');
      expect(status?.type === 'data-flow-status' && status.data.stage).toBe('responding');
    } finally { spy.mockRestore(); }
  });

  it('creates a quiz and evaluates it through the HTTP SDK stream, including tool history', async () => {
    const user: DemoUIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Quiero practicar biología' }] };
    const questionCounts = new Set<number>();
    const quizMessage = await parseSSE(await handleChatRequest(request([user]), env), (message) => {
      const progress = message.parts.find((p) => p.type === 'data-practice-progress');
      const tool = message.parts.find((p) => p.type === 'tool-createPracticeQuestion');
      if (progress && tool?.state === 'input-available') questionCounts.add(progress.data.questions.length);
    });
    expect([...questionCounts]).toEqual([1, 2, 3, 4]);
    const part = quizMessage.parts.find((p) => p.type === 'tool-createPracticeQuestion');
    if (part?.type !== 'tool-createPracticeQuestion' || part.state !== 'output-available') throw new Error('Missing quiz');
    expect(part.output.quizId).toBe('biology-v1');
    expect(part.output.questions).toHaveLength(5);
    const submission: CheckPracticeInput = { ...input([{ questionId: 'q1', selectedOptionIds: ['b'] }]), attemptId: part.output.attemptId };
    const second: DemoUIMessage = { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Comprobar mi autoevaluación' }] };
    const result = await parseSSE(await handleChatRequest(request([user, quizMessage, second], submission), env));
    const feedback = result.parts.find((p) => p.type === 'tool-checkPracticeAnswer');
    if (feedback?.type !== 'tool-checkPracticeAnswer' || feedback.state !== 'output-available') throw new Error('Missing feedback');
    expect(feedback.output.results[0]!.verdict).toBe('incorrect');
    expect(feedback.output.attemptId).toBe(part.output.attemptId);
    const closing = result.parts.at(-1);
    expect(closing).toMatchObject({ type: 'text', text: expect.stringContaining('Pregunta 1') });
    if (closing?.type === 'text') expect(closing.text).toContain('cromosomas');
    const modelMessages = await convertToModelMessages([quizMessage, result], { tools: practiceTools });
    const modelContent = JSON.stringify(modelMessages);
    expect(modelContent).not.toContain('comparison');
    expect(modelContent).not.toContain('measuredTokens');
    expect(modelContent).not.toContain(part.output.questions[0]!.statement);
    expect(modelContent).toContain(feedback.output.results[0]!.eval);
    const third: DemoUIMessage = { id: 'u3', role: 'user', parts: [{ type: 'text', text: 'Dale, repasemos' }] };
    const review = await parseSSE(await handleChatRequest(request([user, quizMessage, second, result, third]), env));
    expect(review.parts).toContainEqual(expect.objectContaining({ type: 'text', text: expect.stringContaining('Pregunta 1') }));
    expect(review.parts.some((p) => p.type === 'tool-createPracticeQuestion')).toBe(false);
  });

  it.each([
    [['a'], '¡Felicitaciones!'],
    [[], 'No quedaron respuestas para corregir.'],
  ])('closes a single-question attempt based on what was answered (%j)', async (selectedOptionIds, expected) => {
    const quiz = createPracticeQuestion('single-question-' + selectedOptionIds.length, 1);
    const user: DemoUIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Comprobar' }] };
    const result = await parseSSE(await handleChatRequest(request([user], {
      quizId: quiz.quizId, attemptId: quiz.attemptId, answers: [{ questionId: 'q1', selectedOptionIds }],
    }), env));
    expect(result.parts.at(-1)).toMatchObject({ type: 'text', text: expect.stringContaining(expected) });
  });

  it('rejects unknown options and stale quiz versions before streaming', async () => {
    const user: DemoUIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Comprobar' }] };
    expect((await handleChatRequest(request([user], input([{ questionId: 'q1', selectedOptionIds: ['forged'] }])), env)).status).toBe(400);
    const req = new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ messages: [user],
      practiceAction: { type: 'check-practice', input: { ...input(), quizId: 'old-version' } } }) });
    expect((await handleChatRequest(req, env)).status).toBe(400);
  });
});
