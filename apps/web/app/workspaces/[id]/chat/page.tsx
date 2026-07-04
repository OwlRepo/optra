"use client";

import * as React from "react";
import Link from "next/link";
import { type Message } from "ai";
import { useChat } from "ai/react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  StatusBanner,
  useToast,
} from "@repo/ui";
import {
  Bot,
  FileStack,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCcw,
  Search,
  Send,
  Square,
} from "lucide-react";
import { logout } from "@/lib/api/auth";
import { getChatMessages, listChatSessions } from "@/lib/api/chat";
import { isUnauthorized } from "@/lib/api/handle-unauthorized";
import { getWorkspace } from "@/lib/api/workspaces";
import { WorkspaceNav } from "@/components/workspace-nav";

type ChatSource = {
  sourceType?: "document" | "ticket";
  documentId?: string;
  ticketId?: string;
  title: string;
  sourceUrl?: string | null;
  score: number;
  snippet: string;
};

type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type ChatSessionList = {
  items: ChatSession[];
  nextCursor: string | null;
};

type PersistedChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[] | null;
  createdAt: string;
};

type ChatMessageList = {
  items: PersistedChatMessage[];
  nextCursor: string | null;
};

const suggestedPrompts = [
  "How do I reset a password for a customer account?",
  "What is our refund policy for annual plans?",
  "Customer cannot access invoices after SSO migration. What should support do?",
];

const markdownComponents = {
  p: ({ children }: React.ComponentPropsWithoutRef<"p">) => (
    <p className="mb-3 last:mb-0">{children}</p>
  ),
  ul: ({ children }: React.ComponentPropsWithoutRef<"ul">) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: React.ComponentPropsWithoutRef<"ol">) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }: React.ComponentPropsWithoutRef<"li">) => (
    <li className="pl-1">{children}</li>
  ),
  a: ({ children, href }: React.ComponentPropsWithoutRef<"a">) =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-medium underline underline-offset-4"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  code: ({ children, className }: React.ComponentPropsWithoutRef<"code">) => (
    <code
      className={
        className ??
        "rounded bg-black/5 px-1 py-0.5 font-mono text-[0.92em] dark:bg-white/10"
      }
    >
      {children}
    </code>
  ),
  pre: ({ children }: React.ComponentPropsWithoutRef<"pre">) => (
    <pre className="mb-3 overflow-x-auto rounded-2xl bg-black/5 p-3 text-[0.92em] last:mb-0 dark:bg-white/10">
      {children}
    </pre>
  ),
  strong: ({ children }: React.ComponentPropsWithoutRef<"strong">) => (
    <strong className="font-semibold">{children}</strong>
  ),
};

function parseSourcesHeader(value: string | null): ChatSource[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toChatMessage(message: PersistedChatMessage): Message {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
  };
}

function toMessageSources(rows: PersistedChatMessage[]) {
  return Object.fromEntries(
    rows
      .filter((row) => Array.isArray(row.sources) && row.sources.length > 0)
      .map((row) => [row.id, row.sources ?? []]),
  );
}

export default function WorkspaceChatPage({
  params,
}: {
  params: { id: string };
}) {
  const workspaceId = params.id;
  const router = useRouter();
  const { toast } = useToast();
  const toastRef = React.useRef(toast);
  const pendingSourcesRef = React.useRef<ChatSource[]>([]);
  const pendingSessionIdRef = React.useRef<string | null>(null);
  const [workspace, setWorkspace] = React.useState<{
    id: string;
    name: string;
  } | null>(null);
  const [sessions, setSessions] = React.useState<ChatSession[]>([]);
  const [nextSessionCursor, setNextSessionCursor] = React.useState<
    string | null
  >(null);
  const [activeSessionId, setActiveSessionId] = React.useState<
    string | undefined
  >();
  const [isLoadingMoreSessions, setIsLoadingMoreSessions] =
    React.useState(false);
  const [nextMessageCursor, setNextMessageCursor] = React.useState<
    string | null
  >(null);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] =
    React.useState(false);
  const [sessionLoadError, setSessionLoadError] = React.useState<string | null>(
    null,
  );
  const [messageSources, setMessageSources] = React.useState<
    Record<string, ChatSource[]>
  >({});
  const [showHistory, setShowHistory] = React.useState(false);

  React.useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const loadSessions = React.useCallback(async () => {
    try {
      const data = await listChatSessions(workspaceId);
      const rows =
        data && typeof data === "object" ? (data as ChatSessionList) : null;
      setSessions(Array.isArray(rows?.items) ? rows.items : []);
      setNextSessionCursor(rows?.nextCursor ?? null);
      setSessionLoadError(null);
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
        return;
      }

      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Try again in a moment.";

      setSessionLoadError(message);
    }
  }, [router, workspaceId]);

  const loadMoreSessions = React.useCallback(async () => {
    if (!nextSessionCursor || isLoadingMoreSessions) {
      return;
    }

    setIsLoadingMoreSessions(true);

    try {
      const data = await listChatSessions(workspaceId, {
        cursor: nextSessionCursor,
      });
      const rows =
        data && typeof data === "object" ? (data as ChatSessionList) : null;
      const nextItems = Array.isArray(rows?.items) ? rows.items : [];

      setSessions((current) => [...current, ...nextItems]);
      setNextSessionCursor(rows?.nextCursor ?? null);
      setSessionLoadError(null);
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
        return;
      }

      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Try again in a moment.";

      setSessionLoadError(message);
    } finally {
      setIsLoadingMoreSessions(false);
    }
  }, [isLoadingMoreSessions, nextSessionCursor, router, workspaceId]);

  const {
    messages,
    setMessages,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    reload,
    stop,
  } = useChat({
    api: `/api/workspaces/${workspaceId}/chat`,
    streamProtocol: "text",
    body: activeSessionId ? { sessionId: activeSessionId } : undefined,
    keepLastMessageOnError: true,
    onResponse: (response) => {
      if (response.status === 401) {
        router.push("/login");
        return;
      }

      pendingSourcesRef.current = parseSourcesHeader(
        response.headers.get("x-chat-sources"),
      );
      pendingSessionIdRef.current = response.headers.get("x-chat-session-id");
    },
    onFinish: async (message) => {
      if (pendingSourcesRef.current.length > 0) {
        setMessageSources((current) => ({
          ...current,
          [message.id]: pendingSourcesRef.current,
        }));
      }

      const nextSessionId =
        pendingSessionIdRef.current ?? activeSessionId ?? undefined;
      pendingSourcesRef.current = [];
      pendingSessionIdRef.current = null;

      if (nextSessionId) {
        React.startTransition(() => {
          setActiveSessionId(nextSessionId);
        });
      }

      await loadSessions();

      if (nextSessionId) {
        try {
          const data = await getChatMessages(workspaceId, nextSessionId);
          const rows =
            data && typeof data === "object" ? (data as ChatMessageList) : null;
          const items = Array.isArray(rows?.items) ? rows.items : [];
          setMessages(items.map(toChatMessage));
          setMessageSources(toMessageSources(items));
          setNextMessageCursor(rows?.nextCursor ?? null);
        } catch (err) {
          if (isUnauthorized(err)) {
            router.push("/login");
            return;
          }
        }
      }
    },
    onError: (chatError) => {
      if (chatError.message === "Unauthorized") {
        router.push("/login");
        return;
      }

      toastRef.current({
        variant: "error",
        title: "Assistant unavailable",
        description:
          chatError.message ||
          "We could not complete your request. Retry when ready.",
      });
    },
  });

  React.useEffect(() => {
    void Promise.all([
      loadSessions(),
      getWorkspace(workspaceId).then((data) => {
        setWorkspace(data);
      }),
    ]).catch((err) => {
      if (isUnauthorized(err)) {
        router.push("/login");
      }
    });
  }, [loadSessions, router, workspaceId]);

  const handleLogout = React.useCallback(async () => {
    try {
      await logout();
    } finally {
      router.push("/login");
    }
  }, [router]);

  const loadSessionMessages = React.useCallback(
    async (sessionId: string) => {
      try {
        const data = await getChatMessages(workspaceId, sessionId);
        const rows =
          data && typeof data === "object" ? (data as ChatMessageList) : null;
        const items = Array.isArray(rows?.items) ? rows.items : [];

        React.startTransition(() => {
          setActiveSessionId(sessionId);
          setMessages(items.map(toChatMessage));
          setMessageSources(toMessageSources(items));
          setNextMessageCursor(rows?.nextCursor ?? null);
        });
      } catch (err) {
        if (isUnauthorized(err)) {
          router.push("/login");
          return;
        }

        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Try again in a moment.";

        toastRef.current({
          variant: "error",
          title: "Failed to load chat history",
          description: message,
        });
      }
    },
    [router, setMessages, workspaceId],
  );

  const loadOlderMessages = React.useCallback(async () => {
    if (!activeSessionId || !nextMessageCursor || isLoadingOlderMessages) {
      return;
    }

    setIsLoadingOlderMessages(true);

    try {
      const data = await getChatMessages(workspaceId, activeSessionId, {
        cursor: nextMessageCursor,
      });
      const rows =
        data && typeof data === "object" ? (data as ChatMessageList) : null;
      const items = Array.isArray(rows?.items) ? rows.items : [];

      setMessages((current) => [...items.map(toChatMessage), ...current]);
      setMessageSources((current) => ({
        ...toMessageSources(items),
        ...current,
      }));
      setNextMessageCursor(rows?.nextCursor ?? null);
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
        return;
      }

      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Try again in a moment.";

      toastRef.current({
        variant: "error",
        title: "Failed to load older messages",
        description: message,
      });
    } finally {
      setIsLoadingOlderMessages(false);
    }
  }, [
    activeSessionId,
    isLoadingOlderMessages,
    nextMessageCursor,
    router,
    setMessages,
    workspaceId,
  ]);

  const submitForm = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!input.trim() || isLoading) {
      return;
    }
    handleSubmit(event);
  };

  const startNewChat = () => {
    React.startTransition(() => {
      setActiveSessionId(undefined);
      setMessages([]);
      setMessageSources({});
      setNextMessageCursor(null);
      setInput("");
    });
  };

  const latestAssistantSources = [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        (messageSources[message.id]?.length ?? 0) > 0,
    );

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => (
        <Link
          href="/workspaces"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            {workspace?.name?.[0]?.toUpperCase() ?? "W"}
          </span>
          {!collapsed ? (
            <span className="truncate">{workspace?.name ?? "Workspace"}</span>
          ) : null}
        </Link>
      )}
      navigation={({ collapsed }) => (
        <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />
      )}
      title="Workspace assistant"
      description="Grounded workspace answers with saved history and source citations."
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            aria-pressed={showHistory}
            onClick={() => setShowHistory((current) => !current)}
          >
            {showHistory ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeftOpen className="size-4" />
            )}
            {showHistory ? "Hide history" : "Show history"}
          </Button>
          <Button size="sm" variant="outline" onClick={startNewChat}>
            New chat
          </Button>
        </>
      }
      onLogout={handleLogout}
    >
      <div
        className={`grid gap-6 px-6 py-10 ${
          showHistory
            ? "xl:grid-cols-[18rem_minmax(0,1fr)_20rem]"
            : "xl:grid-cols-[minmax(0,1fr)_20rem]"
        }`}
      >
        {showHistory ? (
          <Card variant="subtle" className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-primary">History</p>
                <p className="text-xs text-muted-foreground">
                  Your sessions in this workspace
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void loadSessions()}
              >
                <RefreshCcw className="size-4" />
              </Button>
            </div>

            <div className="mt-4 space-y-2">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`w-full rounded-2xl border px-3 py-3 text-left text-sm transition ${
                    activeSessionId === session.id
                      ? "border-primary bg-primary/5"
                      : "border-border/70 bg-background hover:border-primary/30"
                  }`}
                  onClick={() => void loadSessionMessages(session.id)}
                >
                  <p className="font-medium">{session.title}</p>
                </button>
              ))}

              {sessions.length === 0 ? (
                <EmptyState
                  icon={<MessageSquareText className="size-5" />}
                  title="No chat history yet"
                  description="Start first workspace conversation to create saved history."
                />
              ) : null}

              {nextSessionCursor ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void loadMoreSessions()}
                  isLoading={isLoadingMoreSessions}
                  loadingText="Loading"
                >
                  Load more sessions
                </Button>
              ) : null}
            </div>

            {sessionLoadError ? (
              <StatusBanner
                className="mt-4"
                variant="error"
                title="Failed to load sessions"
                description={sessionLoadError}
              />
            ) : null}
          </Card>
        ) : null}

        <Card
          variant="elevated"
          className="flex min-h-[70vh] flex-col overflow-hidden"
        >
          <div className="border-b border-border/70 px-6 py-5 sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-primary">
                  Workspace-scoped answers
                </p>
                <h2 className="mt-1 text-2xl font-semibold">
                  Ask questions across this workspace
                </h2>
              </div>
              <Badge variant={isLoading ? "secondary" : "success"}>
                {isLoading ? "Searching" : "Ready"}
              </Badge>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6 sm:px-8">
            {error ? (
              <StatusBanner
                variant="error"
                title="Request interrupted"
                description={
                  error.message || "Assistant could not complete response."
                }
              />
            ) : null}

            {messages.length === 0 ? (
              <EmptyState
                icon={<Bot className="size-5" />}
                title="Start workspace chat"
                description="Ask policy, troubleshooting, or product questions grounded in your indexed docs."
                actions={
                  <div className="flex flex-wrap justify-center gap-2">
                    {suggestedPrompts.map((prompt) => (
                      <Button
                        key={prompt}
                        variant="outline"
                        size="sm"
                        onClick={() => setInput(prompt)}
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                }
              />
            ) : (
              <div className="space-y-4">
                {nextMessageCursor ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadOlderMessages()}
                    isLoading={isLoadingOlderMessages}
                    loadingText="Loading"
                  >
                    Load older messages
                  </Button>
                ) : null}

                {messages.map((message) => (
                  <div key={message.id} className="w-full">
                    <div
                      className={`w-full rounded-[calc(var(--radius)+0.25rem)] border px-4 py-4 text-sm shadow-[var(--shadow-sm)] sm:px-5 ${
                        message.role === "user"
                          ? "border-primary/20 bg-primary/5"
                          : "border-border/70 bg-secondary/40"
                      }`}
                    >
                      <div
                        className={`w-full ${message.role === "user" ? "ml-auto max-w-3xl" : "max-w-3xl"}`}
                      >
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          {message.role}
                        </p>
                        <div className="leading-7 text-foreground/95">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={markdownComponents}
                          >
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border/70 bg-background/70 px-6 py-5 backdrop-blur-sm sm:px-8">
            <form onSubmit={submitForm} className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={input}
                  onChange={handleInputChange}
                  placeholder="Ask a workspace question…"
                  className="h-12 flex-1 text-base"
                  disabled={isLoading}
                />
                <div className="flex gap-3">
                  {isLoading ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      onClick={stop}
                    >
                      <Square className="size-4" />
                      Stop
                    </Button>
                  ) : null}
                  <Button
                    type="submit"
                    size="lg"
                    isLoading={isLoading}
                    loadingText="Sending"
                  >
                    {!isLoading ? <Send className="size-4" /> : null}
                    {!isLoading ? "Send" : null}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </Card>

        <Card variant="subtle" className="p-4">
          <div className="flex items-center gap-3">
            <Search className="size-5 text-primary" />
            <div>
              <p className="text-sm font-semibold text-primary">Sources</p>
              <p className="text-xs text-muted-foreground">
                Latest assistant citations
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {latestAssistantSources ? (
              messageSources[latestAssistantSources.id]?.map((source) => {
                const key =
                  source.sourceType === "ticket"
                    ? source.ticketId
                    : source.documentId;
                const sourceUrl =
                  source.sourceType === "ticket" ? null : source.sourceUrl;
                return (
                  <div
                    key={`${latestAssistantSources.id}-${key}`}
                    className="rounded-2xl border border-border/70 bg-background px-3 py-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      {sourceUrl ? (
                        <a
                          href={sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {source.title}
                        </a>
                      ) : (
                        <p className="font-medium">{source.title}</p>
                      )}
                      <Badge variant="outline">{source.score.toFixed(2)}</Badge>
                    </div>
                    <p className="mt-2 line-clamp-4 text-xs leading-6 text-muted-foreground">
                      {source.snippet}
                    </p>
                  </div>
                );
              })
            ) : (
              <EmptyState
                icon={<FileStack className="size-5" />}
                title="No citations yet"
                description="Cited sources appear here after assistant finishes an answer."
              />
            )}
          </div>

          {messages.some((message) => message.role === "assistant") ? (
            <div className="mt-4">
              <Button variant="ghost" size="sm" onClick={() => void reload()}>
                Retry last answer
              </Button>
            </div>
          ) : null}
        </Card>
      </div>
    </AppShell>
  );
}
