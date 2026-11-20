import { Output } from 'ai';
import { resolveDemoConfig, routeSchema, startersSchema, type DemoEnv } from '../shared/contracts.ts';
import { createGetModel, generateDemoOutput } from './models.ts';
import { findFaqEntry, GREETING } from './fixtures.ts';
import { nodeCapabilities } from './nodes.ts';
import { createMockDecideRoute, ROUTE_CRITERIA } from './router.ts';

export async function handleStartersRequest(request: Request, env: DemoEnv): Promise<Response> {
  const examples = startersSchema.parse(Object.fromEntries(
    routeSchema.options.map((route) => [route, nodeCapabilities[route].example]),
  ));

  try {
    const config = resolveDemoConfig(env);
    if (!config.chatgptToken) return Response.json(examples);

    const output = await generateDemoOutput({
      model: createGetModel(config)(),
      instructions: [
        'Generá un disparador por nodo para un chat en español rioplatense.',
        'La etiqueta debe ser breve. El texto debe ser un mensaje listo para enviar.',
        'En académico pedí practicar biología para abrir la autoevaluación.',
        'En institucional elegí una consulta que el nodo pueda responder. En fallback saludá a BeerJS Córdoba y empezá el mensaje con Hola.',
      ].join(' '),
      prompt: JSON.stringify({ responsibilities: ROUTE_CRITERIA, nodes: nodeCapabilities }),
      output: Output.object({ schema: startersSchema }),
      abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]),
      reasoning: 'none',
      maxOutputTokens: 500,
      maxRetries: 0,
    });

    const classify = createMockDecideRoute();
    for (const route of routeSchema.options) {
      const text = output[route].text;
      const decision = await classify({ latestUserText: text, history: [] }, request.signal);
      if (
        decision.route !== route ||
        (route === 'academico' &&
          !decision.practice?.topic) ||
        (route === 'institucional' && !findFaqEntry(text)) ||
        (route === 'fallback' && (!GREETING.test(text) || !/BeerJS Córdoba/i.test(text)))
      ) {
        output[route] = examples[route];
      }
    }
    output.fallback.label = examples.fallback.label;
    return Response.json(output);
  } catch {
    return Response.json(examples, { headers: { 'Cache-Control': 'no-store' } });
  }
}
