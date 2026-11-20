import { useEffect, useState } from 'react';
import { Button } from './Button';

const loginErrors: Record<string, string> = {
  denied: 'Hace falta autorizar el uso de tu plan de ChatGPT.',
  expired: 'El inicio de sesión venció. Volvé a intentarlo.',
  error: 'No se pudo conectar con ChatGPT. Volvé a intentarlo.',
  model: 'GPT-6 Luna no aparece entre los modelos disponibles para esta cuenta.',
};

export function ChatGPTConnection() {
  const [session, setSession] = useState<{ connected: boolean; email?: string }>();
  const [loginError] = useState(() => {
    const url = new URL(window.location.href);
    return loginErrors[url.searchParams.get('chatgpt') ?? ''];
  });

  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/chatgpt/session', { signal: abort.signal })
      .then(async (response) => {
        if (response.ok) setSession(await response.json());
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);

  if (!session) return null;

  return (
    <div className="space-y-1">
      {session.connected ? (
        <form action="/api/chatgpt/logout" method="post" className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">ChatGPT conectado {session.email}</span>
          <Button type="submit" variant="ghost" size="sm">Desconectar</Button>
        </form>
      ) : (
        <form action="/api/chatgpt/login" method="post">
          <Button type="submit" variant="outline" size="sm">Continue with ChatGPT</Button>
        </form>
      )}
      {loginError && <p role="alert" className="text-destructive text-sm">{loginError}</p>}
    </div>
  );
}
