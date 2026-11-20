import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { createChatGPTAuth } from './chatgpt-auth.ts';
import { handleApiRequest } from './chat.ts';

export function createApiMiddleware(useChatGPT = false) {
  const auth = useChatGPT ? createChatGPTAuth() : undefined;
  return async (incoming: IncomingMessage, outgoing: ServerResponse, next: () => void) => {
    const host = incoming.headers.host ?? '';
    const localHost = /^127\.0\.0\.1(?::\d+)?$/.test(host);
    const path = incoming.url ?? '/';
    if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) {
      outgoing.writeHead(400).end();
      return;
    }
    const url = new URL(path, localHost ? 'http://' + host : 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      next();
      return;
    }

    const abort = new AbortController();
    const onClose = () => {
      if (!outgoing.writableFinished) abort.abort();
    };
    outgoing.once('close', onClose);

    try {
      const method = incoming.method ?? 'GET';
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const init: RequestInit & { duplex?: 'half' } = { method, headers, signal: abort.signal };
      if (method !== 'GET' && method !== 'HEAD') {
        // Node and DOM declarations differ for the same Web Streams implementation.
        init.body = Readable.toWeb(incoming) as unknown as ReadableStream;
        init.duplex = 'half';
      }
      const request = new Request(url, init);
      const sameOrigin = headers.get('origin') === url.origin;
      const localRead = method === 'GET' && headers.get('sec-fetch-site') !== 'cross-site';
      const token = localHost && (localRead || sameOrigin) ? auth?.current(request)?.token : undefined;
      const response = auth && localHost && url.pathname.startsWith('/api/chatgpt/')
        ? await auth.handle(request)
        : await handleApiRequest(request, { CHATGPT_ACCESS_TOKEN: token });
      if (useChatGPT) response.headers.set('Cache-Control', 'no-store');
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        await pipeline(response.body as unknown as NodeReadableStream, outgoing, { signal: abort.signal });
      } else {
        outgoing.end();
      }
    } catch {
      if (outgoing.destroyed) return;
      if (outgoing.headersSent) {
        outgoing.destroy();
      } else {
        outgoing.writeHead(500, { 'Content-Type': 'application/json' });
        outgoing.end(JSON.stringify({ error: 'Error interno del servidor.' }));
      }
    } finally {
      outgoing.off('close', onClose);
    }
  };
}
