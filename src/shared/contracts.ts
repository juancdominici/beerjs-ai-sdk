import { z } from 'zod';
import type { LanguageModel, UIMessage } from 'ai';
import type { PracticeAction, PracticeProgress, PracticeUITools } from './practice.ts';

export const BEERJS_CORDOBA_NAME = 'BeerJS Córdoba';
export const BEERJS_CORDOBA_URL = 'https://beerjscba.com/';

export const BEERJS_CORDOBA_LINK = `[${BEERJS_CORDOBA_NAME}](${BEERJS_CORDOBA_URL})`;

/** Exact route set for the demo. */
export const routeSchema = z.enum(['academico', 'institucional', 'fallback']);
export type Route = z.infer<typeof routeSchema>;

export const routeSourceSchema = z.enum(['chatgpt', 'mock', 'policy']);
export type RouteSource = z.infer<typeof routeSourceSchema>;

export const routeReasonSchema = z.enum([
  'classified',
  'router-unavailable',
  'invalid-decision',
  'out-of-scope',
]);
export type RouteReason = z.infer<typeof routeReasonSchema>;

export const routeDecisionSchema = z.object({
  route: routeSchema,
  source: routeSourceSchema,
  reason: routeReasonSchema,
  confidence: z.number().finite().min(0).max(1).optional(),
});
export type RouteDecision = z.infer<typeof routeDecisionSchema>;

export const historyTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
});
export type HistoryTurn = z.infer<typeof historyTurnSchema>;

export const routingContextSchema = z.object({
  latestUserText: z.string().min(1),
  history: z.array(historyTurnSchema),
  hasCompletedPractice: z.boolean().optional(),
});
export type RoutingContext = z.infer<typeof routingContextSchema>;

export const flowStageSchema = z.enum(['routing', 'responding', 'done']);
export type FlowStage = z.infer<typeof flowStageSchema>;

/** Observable demo mode for UI badges. */
export const flowModeSchema = z.enum(['mock', 'chatgpt']);
export type FlowMode = z.infer<typeof flowModeSchema>;

export const flowStatusDataSchema = z.object({
  stage: flowStageSchema,
  mode: flowModeSchema,
});
export type FlowStatusData = z.infer<typeof flowStatusDataSchema>;

/**
 * Custom UI message data parts shared by server and client.
 * AI SDK names parts `data-<key>`; keys here map to those types.
 */
export type DemoDataParts = {
  'flow-status': FlowStatusData;
  route: RouteDecision;
  'practice-progress': PracticeProgress;
};

export type DemoUIMessage = UIMessage<never, DemoDataParts, PracticeUITools>;

/** Limits enforced by the chat handler (T4). */
export const CHAT_BODY_LIMIT_BYTES = 32 * 1024;
export const CHAT_HISTORY_LIMIT = 20;
export const CHAT_INPUT_MAX_CHARS = 4_000;
export const starterSchema = z.object({
  label: z.string().trim().min(1).max(40),
  text: z.string().trim().min(1).max(200),
});
export const startersSchema = z.strictObject({
  academico: starterSchema,
  institucional: starterSchema,
  fallback: starterSchema,
});
export type Starters = z.infer<typeof startersSchema>;

export type DemoConfig = { chatgptToken?: string };
export type DemoEnv = { CHATGPT_ACCESS_TOKEN?: string };

export type PracticePlan = { topic: string | null; count: number };
export type RoutingDecision = RouteDecision & { practice?: PracticePlan; review?: true };

export type DecideRoute = (
  context: RoutingContext,
  signal: AbortSignal,
) => Promise<RoutingDecision>;

/**
 * Dependencies injected into node handlers.
 */
export type DemoDependencies = {
  config: DemoConfig;
  decideRoute: DecideRoute;
  /** Language model used by generative nodes when generation is available. */
  getModel: () => LanguageModel;
};

/**
 * Validated turn context passed to a single node.
 * `messages` are UI messages already checked by the chat handler.
 */
export type ValidatedTurnContext = {
  latestUserText: string;
  history: HistoryTurn[];
  messages: DemoUIMessage[];
  practiceAction?: PracticeAction;
};

/**
 * Progressive text produced by a node. `chat.ts` merges this into the
 * official UI Message Stream; nodes never build HTTP responses.
 */
export type NodeStream = {
  textStream: AsyncIterable<string>;
  toolStream?: AsyncIterable<import('ai').InferUIMessageChunk<DemoUIMessage>>;
};

export type NodeHandler = (input: {
  context: ValidatedTurnContext;
  decision: RoutingDecision;
  signal: AbortSignal;
  deps: DemoDependencies;
}) => Promise<NodeStream>;

export type NodeRegistry = Record<Route, NodeHandler>;

export function createFlowStatusId(turnId: string): string {
  return `flow-status:${turnId}`;
}

export function createRoutePartId(turnId: string): string {
  return `route:${turnId}`;
}

export function resolveFlowMode(config: DemoConfig): FlowMode {
  return config.chatgptToken ? 'chatgpt' : 'mock';
}

export function resolveDemoConfig(env: DemoEnv): DemoConfig {
  return { chatgptToken: env.CHATGPT_ACCESS_TOKEN?.trim() };
}

export function getMessageText(message: DemoUIMessage): string {
  return message.parts.map((part) => part.type === 'text' ? part.text : '').join('');
}
