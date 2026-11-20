import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { CHATGPT_MODEL } from './models.ts';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const authorize = issuer + '/api/accounts/authorize';
const tokenEndpoint = issuer + '/api/accounts/oauth/token';
const jwks = createRemoteJWKSet(new URL(issuer + '/.well-known/jwks.json'));
const callbackPath = '/api/chatgpt/callback';
const cookieName = 'beerjs_chatgpt';
const stateCookieName = 'beerjs_chatgpt_state';
const random = () => randomBytes(32).toString('base64url');
const tokenSchema = z.object({
  access_token: z.string().min(1),
  id_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string(),
  token_type: z.string().regex(/^Bearer$/i),
});
const modelsSchema = z.object({ models: z.array(z.object({ slug: z.string() })) });

async function hostId() {
  const file = '.env.chatgpt-host.local';
  try {
    await writeFile(file, 'urn:uuid:' + randomUUID(), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return (await readFile(file, 'utf8')).trim();
}

function cookie(id: string, maxAge: number, name = cookieName) {
  return `${name}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function redirect(location: string, sessionCookie?: string) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  if (sessionCookie) headers.set('Set-Cookie', sessionCookie);
  return new Response(null, { status: 303, headers });
}

type Attempt = {
  verifier: string;
  nonce: string;
  state: string;
  redirectUri: string;
  expiresAt: number;
};
type Session = { token: string; email?: string; expiresAt: number };

export function createChatGPTAuth(fetchImpl: typeof fetch = globalThis.fetch) {
  let pending: Attempt | undefined;
  let session: { id: string; value: Session } | undefined;

  function current(request: Request): Session | undefined {
    if (!session) return;
    if (session.value.expiresAt <= Date.now()) {
      session = undefined;
      return;
    }
    const cookies = request.headers.get('cookie')?.split(';').map((part) => part.trim());
    if (cookies?.includes(`${cookieName}=${session.id}`)) return session.value;
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname !== '127.0.0.1') return new Response(null, { status: 403 });
    if (request.method === 'GET' && url.pathname === '/api/chatgpt/session') {
      const active = current(request);
      return Response.json({ connected: !!active, email: active?.email }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (request.method === 'POST' && request.headers.get('origin') === url.origin) {
      if (url.pathname === '/api/chatgpt/logout') {
        if (current(request)) session = undefined;
        pending = undefined;
        return redirect('/', cookie('', 0));
      }
      if (url.pathname === '/api/chatgpt/login') {
        try {
          const host = await hostId();
          const attempt = {
            verifier: random(), nonce: random(), state: random(),
            redirectUri: url.origin + callbackPath,
            expiresAt: Date.now() + 300_000,
          };
          pending = attempt;
          const params = new URLSearchParams({
            client_id: 'dynamic_agent_client',
            agent_name_hint: 'BeerJS AI SDK',
            ext_agent_host_id: host,
            response_type: 'code',
            redirect_uri: attempt.redirectUri,
            scope,
            resource,
            state: attempt.state,
            nonce: attempt.nonce,
            code_challenge_method: 'S256',
            code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'),
          });
          return redirect(authorize + '?' + params, cookie(attempt.state, 300, stateCookieName));
        } catch {
          return redirect('/?chatgpt=error');
        }
      }
    }

    if (request.method !== 'GET' || url.pathname !== callbackPath) {
      return new Response(null, { status: 404 });
    }
    const attempt = pending;
    const { searchParams } = url;
    const browserState = request.headers.get('cookie')?.split(';').map((part) => part.trim());
    if (!attempt || !browserState?.includes(`${stateCookieName}=${attempt.state}`) || attempt.expiresAt <= Date.now() || searchParams.get('state') !== attempt.state) {
      return redirect('/?chatgpt=expired');
    }
    pending = undefined;
    const code = searchParams.get('code');
    const clientId = searchParams.get('client_id');
    if (searchParams.has('error') || !code || !clientId || clientId === 'dynamic_agent_client') {
      return redirect('/?chatgpt=denied');
    }

    try {
      const tokensResponse = await fetchImpl(tokenEndpoint, {
        method: 'POST',
        redirect: 'error',
        body: new URLSearchParams({
          grant_type: 'authorization_code', client_id: clientId, code, code_verifier: attempt.verifier,
          redirect_uri: attempt.redirectUri, resource,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!tokensResponse.ok) return redirect('/?chatgpt=error');
      const tokens = tokenSchema.parse(await tokensResponse.json());
      const { payload } = await jwtVerify(tokens.id_token, jwks, {
        issuer, audience: clientId, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub'],
      });
      if (payload.nonce !== attempt.nonce ||
          (payload.azp !== undefined && payload.azp !== clientId) ||
          (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) {
        return redirect('/?chatgpt=error');
      }
      if (!tokens.scope.split(/\s+/).includes('chatgpt.tokens.use.direct')) {
        return redirect('/?chatgpt=denied');
      }

      const modelsResponse = await fetchImpl(resource + '/models', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      if (!modelsResponse.ok) return redirect('/?chatgpt=error');
      const { models } = modelsSchema.parse(await modelsResponse.json());
      if (!models.some(({ slug }) => slug === CHATGPT_MODEL)) return redirect('/?chatgpt=model');

      const id = random();
      session = {
        id,
        value: {
          token: tokens.access_token,
          email: typeof payload.email === 'string' ? payload.email : undefined,
          expiresAt: Date.now() + tokens.expires_in * 1_000,
        },
      };
      return redirect('/', cookie(id, tokens.expires_in));
    } catch {
      return redirect('/?chatgpt=error');
    }
  }

  return { current, handle };
}
