import { z } from 'zod';

export const PRACTICE_QUESTION_COUNT = 5;
const practiceCountSchema = z.number().int().min(1).max(PRACTICE_QUESTION_COUNT);

export const createPracticeInputSchema = z.object({
  count: practiceCountSchema.optional(),
  topic: z.literal('biology').optional(),
}).strict();

export const publicQuestionSchema = z.object({
  questionId: z.string(),
  statement: z.string(),
  multiple: z.boolean(),
  options: z.array(z.object({ id: z.string(), text: z.string() }).strict()),
}).strict();

const quizIdSchema = z.enum(['biology-v1', 'biology-generated']);

export const practiceQuizSchema = z.object({
  quizId: quizIdSchema,
  attemptId: z.string().min(1).max(100),
  questions: z.array(publicQuestionSchema).min(1).max(PRACTICE_QUESTION_COUNT),
}).strict();

export const practiceProgressSchema = practiceQuizSchema.extend({
  total: practiceCountSchema,
  questions: z.array(publicQuestionSchema).min(1).max(PRACTICE_QUESTION_COUNT - 1),
}).refine(({ questions, total }) => questions.length < total);

export const checkPracticeInputSchema = z.object({
  quizId: quizIdSchema,
  attemptId: z.string().min(1).max(100),
  answers: z.array(z.object({
    questionId: z.string().min(1).max(100),
    selectedOptionIds: z.array(z.string().min(1).max(100)).max(4),
  }).strict()).max(5),
}).strict();

/** Model-authored feedback; verdicts are calculated on the server. */
export const evaluationSchema = z.object({
  questions: z.array(z.object({
    questionId: z.string(),
    eval: z.string().min(1).max(600),
  }).strict()).max(5),
}).strict();

export const practiceResultSchema = z.object({
  quizId: quizIdSchema,
  attemptId: z.string(),
  results: z.array(z.object({
    questionId: z.string(),
    selectedOptionIds: z.array(z.string()),
    verdict: z.enum(['correct', 'partial', 'incorrect', 'unanswered']),
    eval: z.string(),
  }).strict()),
  summary: z.object({ answered: z.number(), correct: z.number(), total: z.number() }),
}).strict();

export const practiceActionSchema = z.object({
  type: z.literal('check-practice'),
  input: checkPracticeInputSchema,
}).strict();

export type PublicPracticeQuestion = z.infer<typeof publicQuestionSchema>;
export type PracticeProgress = z.infer<typeof practiceProgressSchema>;
export type PracticeQuiz = z.infer<typeof practiceQuizSchema>;
export type CheckPracticeInput = z.infer<typeof checkPracticeInputSchema>;
export type PracticeResult = z.infer<typeof practiceResultSchema>;
export type PracticeAction = z.infer<typeof practiceActionSchema>;
export type Evaluation = z.infer<typeof evaluationSchema>;

export type PracticeUITools = {
  createPracticeQuestion: {
    input: z.infer<typeof createPracticeInputSchema>;
    output: PracticeQuiz;
  };
  checkPracticeAnswer: {
    input: CheckPracticeInput;
    output: PracticeResult;
  };
};
