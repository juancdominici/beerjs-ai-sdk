import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PracticeFeedbackBlock, PracticeQuestionBlock } from '../src/client/Practice';
import { checkPracticeAnswer, createPracticeQuestion } from '../src/server/practice';

describe('practice UI rendering', () => {
  const quiz = createPracticeQuestion('ui-attempt');

  it('renders only the first question without exposing a solution', () => {
    const html = renderToStaticMarkup(createElement(PracticeQuestionBlock, {
      quiz, busy: false, submitted: false, onCheck: () => {},
    }));
    expect(html.match(/<fieldset/g)).toHaveLength(1);
    expect(html).not.toContain('type="checkbox"');
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toContain('Pregunta 1 de 5');
    expect(html).toContain('Siguiente');
    expect(html).toMatch(/<button[^>]+\binvisible\b[^>]+aria-hidden="true" disabled="">Comprobar intento<\/button>/);
    expect(html).not.toContain('correctOptionIds');
    expect(html).toContain('aria-label="Autoevaluación"');
    expect(html).not.toContain('El núcleo contiene los cromosomas');
  });

  it('shows the requested total while only the first question is available', () => {
    const html = renderToStaticMarkup(createElement(PracticeQuestionBlock, {
      quiz: { ...quiz, total: 3, questions: quiz.questions.slice(0, 1) },
      busy: true, complete: false, submitted: false, onCheck: () => {},
    }));
    expect(html).toContain('Pregunta 1 de 3');
    expect(html).toContain('1 de 3 disponibles');
  });

  it('locks submitted attempts to prevent accidental duplicate submissions', () => {
    const html = renderToStaticMarkup(createElement(PracticeQuestionBlock, {
      quiz, busy: false, submitted: true, onCheck: () => {},
    }));
    expect(html.match(/<fieldset disabled=""/g)).toHaveLength(1);
    expect(html).toContain('Intento evaluado');
  });

  it('reconstructs the question and selected response with compact feedback', () => {
    const result = checkPracticeAnswer({ quizId: quiz.quizId, attemptId: quiz.attemptId,
      answers: [{ questionId: 'q1', selectedOptionIds: ['b'] }] });
    const html = renderToStaticMarkup(createElement(PracticeFeedbackBlock, { result, quiz }));
    expect(html).toContain(quiz.questions[0]!.statement);
    expect(html).toContain(quiz.questions[0]!.options[1]!.text);
    expect(html).toContain('Revisá tu respuesta');
    expect(html).toContain(result.results[0]!.eval);
    expect(html).toContain('Pregunta 1 de 5');
    expect(html).not.toContain(quiz.questions[1]!.statement);
  });
});
