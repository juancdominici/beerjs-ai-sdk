import type {
  DemoUIMessage,
  FlowStatusData,
  RouteDecision,
} from '../shared/contracts';

export function getRouteData(message: DemoUIMessage): RouteDecision | undefined {
  let latest: RouteDecision | undefined;
  for (const part of message.parts) {
    if (part.type === 'data-route') {
      latest = part.data;
    }
  }
  return latest;
}

export function getFlowStatusData(
  message: DemoUIMessage,
): FlowStatusData | undefined {
  let latest: FlowStatusData | undefined;
  for (const part of message.parts) {
    if (part.type === 'data-flow-status') {
      latest = part.data;
    }
  }
  return latest;
}

export function getLatestFlowStatus(
  messages: readonly DemoUIMessage[],
): FlowStatusData | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const status = getFlowStatusData(messages[i]!);
    if (status) {
      return status;
    }
  }
  return undefined;
}

export function modeBannerLabel(
  mode: FlowStatusData['mode'] | undefined,
): string {
  if (mode === 'chatgpt') return 'Router y generación con GPT-6 Luna';
  return mode === 'mock' ? 'Demo simulada' : 'Chat de práctica';
}

export function flowStageLabel(stage: FlowStatusData['stage']): string {
  switch (stage) {
    case 'routing':
      return 'Enrutando';
    case 'responding':
      return 'Respondiendo';
    case 'done':
      return 'Listo';
  }
}

export function routeLabel(route: RouteDecision['route']): string {
  switch (route) {
    case 'academico':
      return 'Académico';
    case 'institucional':
      return 'Institucional';
    case 'fallback':
      return 'Fallback';
  }
}

export function reasonLabel(reason: RouteDecision['reason']): string {
  switch (reason) {
    case 'classified':
      return 'clasificada';
    case 'router-unavailable':
      return 'router no disponible';
    case 'invalid-decision':
      return 'decisión inválida';
    case 'out-of-scope':
      return 'fuera de alcance';
  }
}
