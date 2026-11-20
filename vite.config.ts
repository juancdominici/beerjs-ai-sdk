import { release } from 'node:os';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { createApiMiddleware } from './src/server/http.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'DEMO_AUTH');
  const useChatGPT = env.DEMO_AUTH === 'chatgpt';
  const watchWindowsDrive = /microsoft/i.test(release()) && /^\/mnt\/[a-z]\//i.test(process.cwd());
  return {
    server: {
      host: useChatGPT ? '127.0.0.1' : undefined,
      watch: watchWindowsDrive ? {
        usePolling: true,
        interval: 300,
        ignored: ['**/{.pnpm-store,.agents,.aws,.codex,.wrangler,artifacts,coverage}/**'],
      } : undefined,
    },
    preview: useChatGPT ? { host: '127.0.0.1' } : undefined,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'beerjs-api',
        configureServer(server) {
          let factory: typeof createApiMiddleware | undefined;
          let api: ReturnType<typeof createApiMiddleware>;
          server.middlewares.use(async (request, response, next) => {
            if (!request.url?.startsWith('/api/')) return next();
            try {
              const module = await server.ssrLoadModule('/src/server/http.ts') as typeof import('./src/server/http.ts');
              if (factory !== module.createApiMiddleware) {
                api = module.createApiMiddleware(useChatGPT);
                factory = module.createApiMiddleware;
              }
              await api(request, response, next);
            } catch (error) {
              next(error);
            }
          });
        },
        async configurePreviewServer(server) {
          const { createApiMiddleware } = await import('./src/server/http.ts');
          server.middlewares.use(createApiMiddleware(useChatGPT));
        },
      },
    ],
  };
});
