import { useState } from 'react';
import { Button } from './Button';
import type { DemoUIMessage } from '../shared/contracts';
import { type CheckPracticeInput, type PracticeProgress, type PracticeQuiz, type PracticeResult } from '../shared/practice';

const verdictLabels = {
  correct: 'Correcta', partial: 'Parcial: faltan opciones', incorrect: 'Revisá tu respuesta', unanswered: 'Sin responder',
};

function findQuiz(messages: DemoUIMessage[], attemptId: string): PracticeQuiz | undefined {
  for (const message of messages) for (const part of message.parts) {
    if (part.type === 'tool-createPracticeQuestion' && part.state === 'output-available' && part.output.attemptId === attemptId) {
      return part.output;
    }
  }
}

function hasResult(messages: DemoUIMessage[], attemptId: string): boolean {
  return messages.some((message) => message.parts.some((part) =>
    part.type === 'tool-checkPracticeAnswer' && part.state === 'output-available' && part.output.attemptId === attemptId));
}

function PracticePagination({ index, available, total, onChange }: {
  index: number; available: number; total: number; onChange: (index: number) => void;
}) {
  return (
    <nav aria-label="Páginas de la práctica" className="flex flex-wrap items-center justify-between gap-2">
      <Button variant="outline" size="sm" disabled={index === 0} onClick={() => onChange(index - 1)}>Anterior</Button>
      <span aria-live="polite" className="text-sm text-muted-foreground">Pregunta {index + 1} de {total}</span>
      <Button variant="outline" size="sm" disabled={index + 1 >= available} onClick={() => onChange(index + 1)}>Siguiente</Button>
    </nav>
  );
}

export function PracticeQuestionBlock({ quiz, busy, submitted, complete = true, onCheck }: {
  quiz: PracticeQuiz | PracticeProgress; busy: boolean; submitted: boolean; complete?: boolean;
  onCheck: (input: CheckPracticeInput) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [index, setIndex] = useState(0);
  const total = 'total' in quiz ? quiz.total : quiz.questions.length;
  const question = quiz.questions[index]!;
  const showCheck = submitted || (complete && index === quiz.questions.length - 1);
  return (
    <section aria-label="Autoevaluación" className="my-3 space-y-6 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-semibold tracking-tight">Práctica</h3>
        <Button className={`ml-auto h-auto min-h-10 max-w-full rounded-xl px-5 py-2 whitespace-normal ${showCheck ? '' : 'invisible'}`} aria-hidden={!showCheck} disabled={!showCheck || busy || submitted} onClick={() => onCheck({
          quizId: quiz.quizId, attemptId: quiz.attemptId,
          answers: quiz.questions.map((q) => ({ questionId: q.questionId, selectedOptionIds: answers[q.questionId] ?? [] })),
        })}>
          {submitted ? 'Intento evaluado' : busy ? 'Esperá a que termine la respuesta…' : 'Comprobar intento'}
        </Button>
      </div>
      <fieldset key={question.questionId} disabled={submitted || (complete ? busy : !busy)} className="space-y-2">
        <legend className="mb-3 text-sm font-semibold leading-relaxed">{index + 1}. {question.statement}</legend>
        {question.multiple && <p className="text-muted-foreground text-xs">Seleccioná todas las opciones que correspondan.</p>}
        {question.options.map((option) => {
          const selected = answers[question.questionId] ?? [];
          return (
            <label key={option.id} className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm leading-relaxed transition-colors hover:border-primary/40 has-checked:border-primary has-checked:bg-secondary">
              <input
                type={question.multiple ? 'checkbox' : 'radio'}
                name={`${quiz.attemptId}:${question.questionId}`}
                value={option.id}
                checked={selected.includes(option.id)}
                onChange={() => setAnswers((current) => ({
                  ...current,
                  [question.questionId]: question.multiple
                    ? selected.includes(option.id) ? selected.filter((id) => id !== option.id) : [...selected, option.id]
                    : [option.id],
                }))}
                className="mt-0.5 accent-current"
              />
              {option.text}
            </label>
          );
        })}
      </fieldset>
      <PracticePagination index={index} available={quiz.questions.length} total={total} onChange={setIndex} />
      {!complete && <p role="status" className="text-sm text-muted-foreground">
        {busy ? `Preparando preguntas… ${quiz.questions.length} de ${total} disponibles` : 'La preparación de preguntas se interrumpió.'}
      </p>}
    </section>
  );
}

export function PracticeFeedbackBlock({ result, quiz }: { result: PracticeResult; quiz?: PracticeQuiz }) {
  const [index, setIndex] = useState(0);
  const row = result.results[index];
  const question = quiz?.questions.find((q) => q.questionId === row?.questionId);
  return (
    <section aria-label="Evaluación del intento" className="my-3 space-y-5 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div>
        <h3 className="text-lg font-semibold tracking-tight">Tu evaluación</h3>
        <p className="text-muted-foreground text-sm">{result.summary.correct} correctas de {result.summary.total} · {result.summary.answered} respondidas</p>
      </div>
      {result.summary.answered === 0 && <p>No hay respuestas para evaluar. Podés iniciar otra práctica cuando quieras.</p>}
      {row && (
        <article key={row.questionId} className="space-y-2 border-t pt-4">
          <h4 className="font-medium">{index + 1}. {question?.statement ?? row.questionId}</h4>
          <p className="text-sm"><strong>Tu respuesta: </strong>{row.selectedOptionIds.map((id) =>
            question?.options.find((o) => o.id === id)?.text ?? id).join(' · ') || 'Sin respuesta'}</p>
          <p className="text-sm font-medium">{verdictLabels[row.verdict]}</p>
          {row.eval && <p className="text-sm">{row.eval}</p>}
        </article>
      )}
      {row && <PracticePagination index={index} available={result.results.length} total={result.results.length} onChange={setIndex} />}
    </section>
  );
}

export function PracticeToolBlocks({ message, messages, busy, onCheck }: {
  message: DemoUIMessage; messages: DemoUIMessage[]; busy: boolean;
  onCheck: (input: CheckPracticeInput) => void;
}) {
  return message.parts.map((part) => {
    if (part.type !== 'tool-createPracticeQuestion' && part.type !== 'tool-checkPracticeAnswer') return null;
    if (part.state === 'output-error') return <p role="alert" key={part.toolCallId} className="text-destructive">{part.errorText}</p>;
    if (part.type === 'tool-createPracticeQuestion' && part.state !== 'output-available') {
      const progress = message.parts.find((item) => item.type === 'data-practice-progress' && item.id === part.toolCallId);
      if (progress?.type === 'data-practice-progress') {
        return <PracticeQuestionBlock key={part.toolCallId} quiz={progress.data} busy={busy && message.id === messages.at(-1)?.id} complete={false} submitted={false} onCheck={onCheck} />;
      }
    }
    if (part.state !== 'output-available') return <p role="status" key={part.toolCallId} className="my-3 text-sm text-muted-foreground">{part.type === 'tool-createPracticeQuestion' ? 'Preparando preguntas…' : 'Evaluando el intento…'}</p>;
    return part.type === 'tool-createPracticeQuestion'
      ? <PracticeQuestionBlock key={part.toolCallId} quiz={part.output} busy={busy} submitted={hasResult(messages, part.output.attemptId)} onCheck={onCheck} />
      : <PracticeFeedbackBlock key={part.toolCallId} result={part.output} quiz={findQuiz(messages, part.output.attemptId)} />;
  });
}
