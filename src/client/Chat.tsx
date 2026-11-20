import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import { Button } from './Button';
import { ChatGPTConnection } from './ChatGPTConnection';
import {
  CHAT_INPUT_MAX_CHARS,
  getMessageText,
  type Route,
  type DemoUIMessage,
  type FlowStatusData,
} from "../shared/contracts";
import {
  flowStageLabel,
  getFlowStatusData,
  getLatestFlowStatus,
  getRouteData,
  modeBannerLabel,
  reasonLabel,
  routeLabel,
} from "./message-parts";
import { loadStarters, readCachedStarters } from './starters';
import { PracticeToolBlocks } from './Practice';
import type { CheckPracticeInput } from '../shared/practice';

const STARTER_ORDER = ['fallback', 'academico', 'institucional'] satisfies Route[];

const transport = new DefaultChatTransport<DemoUIMessage>({
  api: "/api/chat",
});

export function Chat() {
  const {
    messages,
    sendMessage,
    status,
    stop,
    setMessages,
    error,
    clearError,
  } = useChat<DemoUIMessage>({
    transport,
  });

  const busy = status === "submitted" || status === "streaming";
  const flowStatus = getLatestFlowStatus(messages);
  const [draft, setDraft] = useState("");
  const [starters, setStarters] = useState(readCachedStarters);
  const empty = messages.length === 0;

  useEffect(() => {
    if (!empty) return;
    let active = true;
    void loadStarters().then((loaded) => {
      if (active) setStarters(loaded);
    }).catch(() => {});
    return () => { active = false; };
  }, [empty]);

  function handleSend(text: string) {
    const trimmed = text.trim();
    if (busy || !trimmed) {
      return;
    }
    if (error) {
      clearError();
    }
    void sendMessage({ text: trimmed });
  }

  function handleCheckPractice(input: CheckPracticeInput) {
    if (busy) return;
    clearError();
    void sendMessage({ text: 'Comprobar mi autoevaluación' }, {
      body: { practiceAction: { type: 'check-practice', input } },
    });
  }

  function handleNewConversation() {
    void stop();
    setMessages([]);
    clearError();
  }

  return (
    <div className="mx-auto flex h-svh max-h-svh w-full max-w-5xl flex-col border-x bg-background">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b bg-card/70 px-5 py-5 sm:px-8">
        <div className="space-y-1">
          <p className="text-primary font-mono text-[11px] tracking-[0.14em] uppercase">
            BeerJS · AI SDK
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.04em]">Chat demo</h1>
          <p className="text-muted-foreground text-sm">
            {modeBannerLabel(flowStatus?.mode)}
          </p>
          <ChatGPTConnection />
        </div>
        <Button type="button" variant="ghost" onClick={handleNewConversation}>
          Nueva conversación
        </Button>
      </header>

      <div className="shrink-0 px-5 pt-4 sm:px-8">
        <StatusBar flowStatus={flowStatus} />
      </div>

      {error ? (
        <div
          className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 sm:mx-6"
          role="alert"
        >
          <p className="text-destructive text-sm">
            {error.message || "No se pudo completar el turno."}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => clearError()}
          >
            Descartar
          </Button>
        </div>
      ) : null}

      <StickToBottom className="relative min-h-0 flex-1 overflow-y-hidden" initial="smooth" resize="smooth" role="log">
        <StickToBottom.Content className="flex flex-col gap-7 px-5 py-6 sm:px-8">
          {empty ? (
            <div className="flex size-full flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="max-w-lg space-y-6">
                <div className="space-y-1">
                  <h3 className="text-2xl font-semibold tracking-tight">Vamos por partes</h3>
                  {starters && <p className="text-muted-foreground text-sm">
                    Probá un ejemplo para ver el enrutado académico,
                    institucional o fallback.
                  </p>}
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {starters && STARTER_ORDER.map((route) => (
                    <Button
                      key={route}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleSend(starters[route].text)}
                    >
                      {starters[route].label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((message) => {
              const text = getMessageText(message);
              const isEvaluation = message.parts.some((part) => part.type === 'tool-checkPracticeAnswer');
              const tools = <PracticeToolBlocks message={message} messages={messages} busy={busy} onCheck={handleCheckPractice} />;
              const route =
                message.role === "assistant"
                  ? getRouteData(message)
                  : undefined;
              const flow =
                message.role === "assistant"
                  ? getFlowStatusData(message)
                  : undefined;

              return (
                <div
                  key={message.id}
                  className={`group flex w-full max-w-[95%] flex-col gap-2 ${message.role === "user" ? "is-user ml-auto" : ""}`}
                >
                  {message.role === "assistant" && (route || flow) ? (
                    <div className="mb-1 flex flex-wrap gap-2 font-mono text-[11px] text-muted-foreground">
                      {route ? (
                        <span
                          className="rounded-full border px-2 py-0.5"
                          title={reasonLabel(route.reason)}
                        >
                          {routeLabel(route.route)} ·{" "}
                          {reasonLabel(route.reason)}
                        </span>
                      ) : null}
                      {flow && flow.stage !== "done" ? (
                        <span className="rounded-full border px-2 py-0.5">
                          {flowStageLabel(flow.stage)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {isEvaluation && tools}
                  {message.role === 'assistant' ? text && (
                    <div className="min-w-0 max-w-full break-words text-sm leading-relaxed [&>*+*]:mt-2 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-secondary [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5">
                      <Markdown skipHtml components={{ img: () => null }}>{text}</Markdown>
                    </div>
                  ) : (
                    <div className="ml-auto w-fit max-w-full whitespace-pre-wrap break-words rounded-2xl bg-secondary px-4 py-3 text-sm leading-relaxed">
                      {text}
                    </div>
                  )}
                  {!isEvaluation && tools}
                </div>
              );
            })
          )}
        </StickToBottom.Content>
        <ConversationScrollButton />
      </StickToBottom>

      <div className="shrink-0 border-t bg-card/70 p-5 sm:px-8">
        <form
          className="rounded-xl border bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring/50"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !draft.trim()) return;
            handleSend(draft);
            setDraft("");
          }}
        >
          <textarea
            className="block min-h-16 max-h-48 w-full resize-none field-sizing-content rounded-xl px-3 py-2 text-sm outline-none"
            aria-label="Consulta"
            placeholder="Escribí tu consulta…"
            maxLength={CHAT_INPUT_MAX_CHARS}
            disabled={busy}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
          />
          <div className="flex justify-end p-2">
            {busy ? (
              <Button key="stop" onClick={() => void stop()}>Detener</Button>
            ) : (
              <Button key="send" type="submit" disabled={!draft.trim()}>Enviar</Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

type StatusBarProps = {
  flowStatus: FlowStatusData | undefined;
};

function StatusBar({ flowStatus }: StatusBarProps) {
  const modeLabel = modeBannerLabel(flowStatus?.mode);
  const showStage = flowStatus !== undefined && flowStatus.stage !== "done";

  return (
    <div
      className="flex flex-wrap items-center gap-2 font-mono text-[11px]"
      role="status"
      aria-live="polite"
    >
      <span className="rounded-md border border-primary/10 bg-accent/60 px-2.5 py-1 text-accent-foreground">
        {modeLabel}
      </span>
      {showStage ? (
        <span className="text-muted-foreground">
          {flowStageLabel(flowStatus.stage)}
        </span>
      ) : null}
    </div>
  );
}

function ConversationScrollButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;

  return (
    <Button
      className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full"
      variant="outline"
      onClick={() => void scrollToBottom()}
    >
      Ir al final
    </Button>
  );
}
