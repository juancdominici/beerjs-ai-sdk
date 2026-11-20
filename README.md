# Chat con AI SDK

Aplicación de ejemplo con chat en streaming y una actividad de autoevaluación. El servidor enruta cada consulta a uno de tres nodos (`academico`, `institucional`, `fallback`). AI SDK gestiona el flujo de mensajes y React muestra el texto y los datos a medida que llegan.

El modo simulado funciona sin credenciales ni llamadas externas. ChatGPT es la única integración real de la demo.

## Comandos

```bash
pnpm install --frozen-lockfile
pnpm dev          # http://localhost:5173/ — React + servidor Node
pnpm typecheck
pnpm test
pnpm build
pnpm preview      # ejecuta el build con la misma API local
pnpm check        # typecheck + test + build
```

Requiere Node ≥ 22 y pnpm (`packageManager`: `pnpm@10.30.3`).

En WSL, si el repo está en una unidad de Windows como `/mnt/c`, Vite detecta los cambios por sondeo. La API local se carga en la primera consulta y Vite aplica los cambios del servidor en las consultas siguientes.

## Versiones resueltas

| Paquete                               | Versión |
| ------------------------------------- | ------- |
| `ai`                                  | 7.0.169 |
| `@ai-sdk/react`                       | 4.0.173 |
| `@ai-sdk/provider`                    | 4.0.37  |
| `@ai-sdk/openai`                       | 4.0.122 |
| `react` / `react-dom`                 | 19.2.1  |
| `react-markdown`                      | 10.1.0  |
| `zod`                                 | 4.6.7   |
| `vite`                                | 8.3.8   |
| `jose`                                | 6.2.18  |

## Configuración local

Ejecutá `pnpm dev` para usar la demo en modo simulado. Para activar ChatGPT:

1. Copiá `.env.example` a `.env.local` y fijá `DEMO_AUTH=chatgpt`.
2. Reiniciá `pnpm dev`, abrí la URL con `127.0.0.1` y pulsá **Continue with ChatGPT**.
3. Autorizá el uso de tu plan. El servidor verifica el acceso a GPT-6 Luna.

ChatGPT clasifica consultas mediante una salida estructurada y genera explicaciones, disparadores y feedback. Con ChatGPT, la práctica sigue el tema del pedido o de la conversación; si falta, el chat lo pregunta. Las preguntas se generan y muestran de a una, hasta la cantidad pedida (cinco por defecto y como máximo). En modo simulado se usa un banco fijo de biología. La FAQ y la corrección se resuelven en el servidor. Las claves de los 100 intentos generados más recientes se guardan en memoria y se pierden al reiniciar. La sesión se guarda en memoria: si vence o reiniciás el servidor, la demo vuelve al modo simulado hasta que te conectes otra vez.

## Recorrido del chat

1. Enviá una consulta académica, por ejemplo «¿Qué es la fotosíntesis?».
2. Consultá un tema institucional del FAQ, como el horario de atención, y luego enviá una consulta fuera de dominio para recorrer el nodo de respaldo.
3. Pulsá **Quiero practicar**, seleccioná opciones y usá **Comprobar intento**. También podés pedir «Haceme tres preguntas sobre este tema». El servidor corrige el intento y la interfaz muestra el feedback por pregunta.

Las herramientas exponen una proyección compacta mediante `toModelOutput`.

## Flujo para proyectar

| Archivo | Qué mostrar |
| --- | --- |
| [Chat.tsx](src/client/Chat.tsx) | `useChat` envía mensajes a `POST /api/chat` y React muestra las partes del stream. |
| [chat.ts](src/server/chat.ts) | El servidor valida la entrada, decide la ruta y emite el estado, la ruta, el texto y los resultados de las tools. |
| [router.ts](src/server/router.ts) | ChatGPT o las reglas locales eligen la ruta. El servidor aplica el fallback si la clasificación falla. |
| [nodes.ts](src/server/nodes.ts) | El registro conecta las tres rutas con sus handlers. El académico sabe cuándo responder y cuándo abrir la práctica. |
| [practice.ts](src/server/practice.ts) | El servidor arma el cuestionario, corrige el intento y transmite el resultado para que React lo muestre. |

`src/shared/` contiene los contratos. `src/server/models.ts` reúne el modelo simulado y el adaptador de ChatGPT. `src/client/fonts/` contiene las fuentes y sus licencias SIL OFL.

## Cobertura

Las pruebas cubren las rutas, el FAQ, el flujo de mensajes de AI SDK, la práctica, los errores HTTP y la cancelación. La integración con ChatGPT se prueba con HTTP interceptado.
