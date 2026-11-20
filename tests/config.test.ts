import { describe, expect, it } from 'vitest';
import { resolveDemoConfig } from '../src/shared/contracts';
import {
  routeDecisionSchema,
  routeSchema,
  resolveFlowMode,
} from '../src/shared/contracts';

describe('resolveDemoConfig', () => {
  it('selects ChatGPT only when connected', () => {
    expect(resolveFlowMode(resolveDemoConfig({}))).toBe('mock');
    expect(resolveFlowMode(resolveDemoConfig({ CHATGPT_ACCESS_TOKEN: 'plan-token' }))).toBe('chatgpt');
  });
});

describe('shared schemas', () => {
  it('accepts a valid route decision', () => {
    const decision = routeDecisionSchema.parse({
      route: 'academico',
      source: 'mock',
      reason: 'classified',
      confidence: 0.91,
    });
    expect(routeSchema.parse(decision.route)).toBe('academico');
  });
});
