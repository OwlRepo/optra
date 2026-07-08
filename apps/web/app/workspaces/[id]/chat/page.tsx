"use client";

import * as React from "react";
import { type Message } from "ai";
import { useChat } from "ai/react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AppShell,
  Badge,
  Button,
  Card,
  cn,
  EmptyState,
  Input,
  Modal,
  StatusBanner,
  Textarea,
  useToast,
} from "@repo/ui";
import {
  Bookmark,
  Bot,
  Clock,
  Download,
  Eye,
  EyeOff,
  History,
  Loader2,
  Menu,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Send,
  Sparkles,
  Square,
  Undo2,
  Wand2,
} from "lucide-react";
import { logout } from "@/lib/api/auth";
import { getChatMessages, listChatSessions } from "@/lib/api/chat";
import { downloadDocument } from "@/lib/api/documents";
import {
  getRefineStatus,
  listSavedRefinedMessages,
  refineMessage,
  saveRefinedMessage,
  type SavedRefinedMessage,
} from "@/lib/api/refine";
import { downloadTicketTranscript } from "@/lib/api/tickets";
import { isUnauthorized } from "@/lib/api/handle-unauthorized";
import { getWorkspace } from "@/lib/api/workspaces";
import { WorkspaceNav } from "@/components/workspace-nav";
import { WorkspaceBrandLink } from "@/components/workspace-brand-link";

type ChatSource = {
  sourceType?: "document" | "ticket" | "dataset";
  documentId?: string;
  knowledgeBaseId?: string;
  ticketId?: string;
  datasetId?: string;
  title: string;
  sourceUrl?: string | null;
  score: number;
  snippet: string;
};

type StructuredCandidate = {
  id: string;
  name: string;
  description: string | null;
};

type StructuredState = "confident" | "ambiguous" | "correction" | "empty";

type MessageStructuredMeta = {
  state: StructuredState;
  candidates?: StructuredCandidate[];
};

type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type ChatSessionList = {
  items: ChatSession[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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

type MessageTemplate = {
  id: string;
  team: "CSR" | "TSR";
  title: string;
  body: string;
};

const suggestedPrompts = [
  "How do I reset a password for a customer account?",
  "What is our refund policy for annual plans?",
  "Customer cannot access invoices after SSO migration. What should support do?",
];

const thinkingWords = [
  "Thinking…",
  "Noodling…",
  "Digging through the docs…",
  "Connecting the dots…",
  "Almost there…",
];

const messageTemplates: MessageTemplate[] = [
  {
    id: "csr-refund",
    team: "CSR",
    title: "Refund request",
    body: "Customer {{customer_name}} is requesting a refund for {{order_or_invoice}}. Reason given: {{reason}}. Account is on the {{plan_name}} plan. What is our refund policy and next steps?",
  },
  {
    id: "csr-access",
    team: "CSR",
    title: "Account access issue",
    body: "Customer {{customer_name}} cannot access their account after {{recent_change}}. Error message: {{error_message}}. What troubleshooting steps should I follow?",
  },
  {
    id: "tsr-bug",
    team: "TSR",
    title: "Suspected bug",
    body: "Customer reports {{symptom}} when using {{feature}} on {{platform}}. Steps to reproduce: {{steps}}. Is this a known issue, and what is the workaround?",
  },
  {
    id: "tsr-escalation",
    team: "TSR",
    title: "Escalation summary",
    body: "Summarize the troubleshooting done so far for {{ticket_id}}: {{summary}}. What is the recommended next escalation step per our process?",
  },
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

function parseStructuredCandidatesHeader(value: string | null): StructuredCandidate[] {
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
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const toastRef = React.useRef(toast);
  const formRef = React.useRef<HTMLFormElement>(null);
  const pendingSourcesRef = React.useRef<ChatSource[]>([]);
  const pendingSessionIdRef = React.useRef<string | null>(null);
  const pendingStructuredRef = React.useRef<MessageStructuredMeta | null>(null);
  const [workspace, setWorkspace] = React.useState<{
    id: string;
    name: string;
  } | null>(null);
  const [sessions, setSessions] = React.useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = React.useState<
    string | undefined
  >();
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
  const [messageStructured, setMessageStructured] = React.useState<
    Record<string, MessageStructuredMeta>
  >({});
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historySearch, setHistorySearch] = React.useState("");
  const [debouncedHistorySearch, setDebouncedHistorySearch] =
    React.useState("");
  const [templatesOpen, setTemplatesOpen] = React.useState(false);
  const [showScores, setShowScores] = React.useState(false);
  const [thinkingWord, setThinkingWord] = React.useState(thinkingWords[0]);
  const [isRefining, setIsRefining] = React.useState(false);
  const [lastRefine, setLastRefine] = React.useState<{
    original: string;
    refined: string;
  } | null>(null);
  const [refineRemaining, setRefineRemaining] = React.useState<number | null>(
    null,
  );
  const [savedMessagesOpen, setSavedMessagesOpen] = React.useState(false);
  const [savedMessages, setSavedMessages] = React.useState<
    SavedRefinedMessage[]
  >([]);

  React.useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  // Debounce history search so we don't fire a request on every keystroke.
  React.useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedHistorySearch(historySearch.trim()),
      300,
    );
    return () => window.clearTimeout(timeout);
  }, [historySearch]);

  const loadSessions = React.useCallback(async () => {
    try {
      const data = await listChatSessions(workspaceId, {
        pageSize: 5,
        q: debouncedHistorySearch || undefined,
      });
      const rows =
        data && typeof data === "object" ? (data as ChatSessionList) : null;
      setSessions(Array.isArray(rows?.items) ? rows.items : []);
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
  }, [debouncedHistorySearch, router, workspaceId]);

  React.useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

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

      const structuredState = response.headers.get(
        "x-chat-structured-state",
      ) as StructuredState | null;
      pendingStructuredRef.current = structuredState
        ? {
            state: structuredState,
            candidates: parseStructuredCandidatesHeader(
              response.headers.get("x-chat-structured-candidates"),
            ),
          }
        : null;
    },
    onFinish: async (message) => {
      if (pendingSourcesRef.current.length > 0) {
        setMessageSources((current) => ({
          ...current,
          [message.id]: pendingSourcesRef.current,
        }));
      }

      const structuredMeta = pendingStructuredRef.current;
      if (structuredMeta) {
        setMessageStructured((current) => ({
          ...current,
          [message.id]: structuredMeta,
        }));
      }

      const nextSessionId =
        pendingSessionIdRef.current ?? activeSessionId ?? undefined;
      pendingSourcesRef.current = [];
      pendingSessionIdRef.current = null;
      pendingStructuredRef.current = null;

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
    if (!isLoading) return;

    let index = 0;
    setThinkingWord(thinkingWords[0]);
    const intervalId = window.setInterval(() => {
      index = (index + 1) % thinkingWords.length;
      setThinkingWord(thinkingWords[index]);
    }, 1400);

    return () => window.clearInterval(intervalId);
  }, [isLoading]);

  React.useEffect(() => {
    void getWorkspace(workspaceId)
      .then((data) => {
        setWorkspace(data);
      })
      .catch((err) => {
        if (isUnauthorized(err)) {
          router.push("/login");
        }
      });
  }, [router, workspaceId]);

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

  // Deep-link support: opening /chat?session=<id> (e.g. from the global search
  // modal's chat-history results) loads that session on mount.
  React.useEffect(() => {
    const sessionId = searchParams.get("session");
    if (sessionId) {
      void loadSessionMessages(sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSession = React.useCallback(
    (sessionId: string) => {
      void loadSessionMessages(sessionId);
      setHistoryOpen(false);
    },
    [loadSessionMessages],
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

  const handleTextareaKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (input.trim() && !isLoading) {
        formRef.current?.requestSubmit();
      }
    }
  };

  const startNewChat = () => {
    React.startTransition(() => {
      setActiveSessionId(undefined);
      setMessages([]);
      setMessageSources({});
      setMessageStructured({});
      setNextMessageCursor(null);
      setInput("");
    });
  };

  const applyTemplate = (template: MessageTemplate) => {
    setInput(template.body);
    setTemplatesOpen(false);
  };

  const refreshRefineStatus = React.useCallback(async () => {
    try {
      const status = await getRefineStatus(workspaceId);
      setRefineRemaining(
        status && typeof status.remaining === "number" ? status.remaining : null,
      );
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
      }
    }
  }, [router, workspaceId]);

  React.useEffect(() => {
    void refreshRefineStatus();
  }, [refreshRefineStatus]);

  const extractErrorMessage = (err: unknown, fallback: string) =>
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : fallback;

  const handleTextareaChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    handleInputChange(event);
    if (lastRefine && event.target.value !== lastRefine.refined) {
      setLastRefine(null);
    }
  };

  const handleRefine = async () => {
    if (!input.trim() || isLoading || isRefining) {
      return;
    }

    const original = input;
    setIsRefining(true);

    try {
      const result = await refineMessage(workspaceId, original);
      setLastRefine({ original, refined: result.refined });
      setInput(result.refined);
      await refreshRefineStatus();
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
        return;
      }

      toastRef.current({
        variant: "error",
        title: "Refine failed",
        description: extractErrorMessage(err, "Try again in a moment."),
      });
    } finally {
      setIsRefining(false);
    }
  };

  const handleUndoRefine = () => {
    if (!lastRefine) {
      return;
    }
    setInput(lastRefine.original);
    setLastRefine(null);
  };

  const handleSaveRefined = async () => {
    if (!lastRefine) {
      return;
    }

    try {
      await saveRefinedMessage(workspaceId, {
        originalText: lastRefine.original,
        refinedText: lastRefine.refined,
      });
      toastRef.current({
        variant: "success",
        title: "Saved for reuse",
        description: "Find it anytime in Saved messages.",
      });
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
        return;
      }

      toastRef.current({
        variant: "error",
        title: "Failed to save refined message",
        description: extractErrorMessage(err, "Try again in a moment."),
      });
    }
  };

  const loadSavedMessages = React.useCallback(async () => {
    try {
      const data = await listSavedRefinedMessages(workspaceId);
      setSavedMessages(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
        return;
      }

      toastRef.current({
        variant: "error",
        title: "Failed to load saved messages",
        description: extractErrorMessage(err, "Try again in a moment."),
      });
    }
  }, [router, workspaceId]);

  const openSavedMessages = () => {
    setSavedMessagesOpen(true);
    void loadSavedMessages();
  };

  const applySavedMessage = (message: SavedRefinedMessage) => {
    setInput(message.refinedText);
    setSavedMessagesOpen(false);
  };

  const hasAssistantMessage = messages.some(
    (message) => message.role === "assistant",
  );

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => (
        <WorkspaceBrandLink name={workspace?.name} collapsed={collapsed} />
      )}
      navigation={({ collapsed }) => (
        <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />
      )}
      mobileFullBleed
      title="Workspace assistant"
      description="Grounded workspace answers with saved history and source citations."
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="size-4" />
            History
          </Button>
          {hasAssistantMessage ? (
            <Button size="sm" variant="ghost" onClick={() => void reload()}>
              <RefreshCcw className="size-4" />
              Retry last answer
            </Button>
          ) : null}
          <Button size="sm" onClick={startNewChat}>
            <Plus className="size-4" />
            New chat
          </Button>
        </>
      }
      onLogout={handleLogout}
    >
      {({ openMobileNav }) => (
        <>
          <div className="flex h-14 items-center gap-1 border-b border-border/70 bg-background/95 px-2 backdrop-blur-xl lg:hidden">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              onClick={openMobileNav}
            >
              <Menu className="size-4" />
            </Button>
            <p className="min-w-0 flex-1 truncate text-sm font-semibold">
              Workspace assistant
            </p>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Chat history"
              onClick={() => setHistoryOpen(true)}
            >
              <History className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="New chat"
              onClick={startNewChat}
            >
              <Plus className="size-4" />
            </Button>
          </div>
      <div className="h-[calc(100vh-3.5rem)] px-4 py-4 sm:px-6 sm:py-6 lg:h-[calc(100vh-5.75rem)]">
        <Card
          variant="elevated"
          className="flex h-full flex-col overflow-hidden"
        >
          <div className="border-b border-border/70 px-4 py-3 sm:px-8 sm:py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="hidden sm:block">
                <p className="text-sm font-semibold text-primary">
                  Workspace-scoped answers
                </p>
                <h2 className="mt-1 text-2xl font-semibold">
                  Ask questions across this workspace
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={showScores}
                  aria-label={
                    showScores
                      ? "Hide relevance scores"
                      : "Show relevance scores"
                  }
                  onClick={() => setShowScores((current) => !current)}
                >
                  {showScores ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                  <span className="hidden sm:inline">
                    {showScores
                      ? "Hide relevance scores"
                      : "Show relevance scores"}
                  </span>
                </Button>
                <Badge variant={isLoading ? "secondary" : "success"}>
                  {isLoading ? "Searching" : "Ready"}
                </Badge>
              </div>
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

            {messages.length === 0 && !isLoading ? (
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
                        className="h-auto whitespace-normal text-left"
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

                {messages.map((message) => {
                  const sources = messageSources[message.id] ?? [];

                  return (
                    <div
                      key={message.id}
                      className={cn([
                        message.role === "user"
                          ? "flex justify-end ml-auto"
                          : "flex justify-start",
                        "w-fit",
                      ])}
                    >
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

                          {message.role === "assistant" &&
                          sources.length > 0 ? (
                            <div className="mt-4 space-y-2 border-t border-border/50 pt-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                Sources ({sources.length})
                              </p>
                              {sources.map((source) => {
                                const isTicket = source.sourceType === "ticket";
                                const isDataset = source.sourceType === "dataset";
                                const key = isTicket
                                  ? source.ticketId
                                  : isDataset
                                    ? source.datasetId
                                    : source.documentId;
                                const sourceUrl =
                                  isTicket || isDataset ? null : source.sourceUrl;
                                const canDownloadDocument =
                                  !isTicket && !isDataset && Boolean(source.knowledgeBaseId);

                                return (
                                  <div
                                    key={`${message.id}-${key}`}
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
                                        <p className="font-medium">
                                          {source.title}
                                        </p>
                                      )}
                                      {showScores ? (
                                        <Badge variant="outline">
                                          {source.score.toFixed(2)}
                                        </Badge>
                                      ) : null}
                                    </div>
                                    <p className="mt-2 line-clamp-4 text-xs leading-6 text-muted-foreground">
                                      {source.snippet}
                                    </p>
                                    {isTicket ? (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="mt-2"
                                        onClick={() =>
                                          void downloadTicketTranscript(
                                            workspaceId,
                                            source.ticketId!,
                                          )
                                        }
                                      >
                                        <Download className="size-4" />
                                        Download transcript (PDF)
                                      </Button>
                                    ) : canDownloadDocument ? (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="mt-2"
                                        onClick={() =>
                                          void downloadDocument(
                                            workspaceId,
                                            source.knowledgeBaseId!,
                                            source.documentId!,
                                          )
                                        }
                                      >
                                        <Download className="size-4" />
                                        Download document
                                      </Button>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}

                          {message.role === "assistant" &&
                          messageStructured[message.id] &&
                          messageStructured[message.id].state !== "confident" ? (
                            <div className="mt-4 space-y-2 border-t border-border/50 pt-3">
                              {messageStructured[message.id].state ===
                                "ambiguous" &&
                              (messageStructured[message.id].candidates ?? [])
                                .length > 0 ? (
                                <>
                                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                    Which dataset did you mean?
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {messageStructured[
                                      message.id
                                    ].candidates!.map((candidate) => (
                                      <Button
                                        key={candidate.id}
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          setInput(
                                            `Use the "${candidate.name}" dataset`,
                                          )
                                        }
                                      >
                                        {candidate.name}
                                      </Button>
                                    ))}
                                  </div>
                                </>
                              ) : (
                                <Badge variant="outline">
                                  {messageStructured[message.id].state ===
                                  "correction"
                                    ? "Couldn't run that query — try rephrasing"
                                    : "No matching dataset for this question"}
                                </Badge>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {isLoading ? (
                  <div className="w-full">
                    <div className="w-full max-w-3xl rounded-[calc(var(--radius)+0.25rem)] border border-border/70 bg-secondary/40 px-4 py-4 text-sm shadow-[var(--shadow-sm)] sm:px-5">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        assistant
                      </p>
                      <p className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        {thinkingWord}
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="border-t border-border/70 bg-background/70 px-3 py-3 backdrop-blur-sm sm:px-8 sm:py-5">
            <form
              ref={formRef}
              onSubmit={submitForm}
              className="rounded-2xl border border-border bg-background shadow-[var(--shadow-sm)]"
            >
              <Textarea
                value={input}
                onChange={handleTextareaChange}
                onKeyDown={handleTextareaKeyDown}
                placeholder="Ask a workspace question…"
                rows={2}
                className="min-h-[2.75rem] resize-none border-0 bg-transparent px-4 py-3 text-base shadow-none focus-visible:ring-0"
                disabled={isLoading}
              />
              <div className="flex items-center justify-between gap-1 border-t border-border/60 px-2 py-1.5">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Message templates"
                    onClick={() => setTemplatesOpen(true)}
                  >
                    <Sparkles className="size-4" />
                  </Button>
                  <div className="relative">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={isRefining ? "Refining" : "Refine with Mnemra"}
                      onClick={() => void handleRefine()}
                      disabled={!input.trim() || isLoading}
                      isLoading={isRefining}
                    >
                      {!isRefining ? <Wand2 className="size-4" /> : null}
                    </Button>
                    {!isRefining && refineRemaining !== null ? (
                      <span className="pointer-events-none absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-secondary px-1 text-[10px] font-medium leading-none text-secondary-foreground">
                        {refineRemaining}
                      </span>
                    ) : null}
                  </div>
                  {lastRefine ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Undo refine"
                        onClick={handleUndoRefine}
                      >
                        <Undo2 className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Save refined message"
                        onClick={() => void handleSaveRefined()}
                      >
                        <Save className="size-4" />
                      </Button>
                    </>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Saved messages"
                    onClick={openSavedMessages}
                  >
                    <Bookmark className="size-4" />
                  </Button>
                </div>
                {isLoading ? (
                  <Button
                    type="button"
                    variant="default"
                    size="icon"
                    aria-label="Stop"
                    onClick={stop}
                  >
                    <Square className="size-4" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon"
                    variant={input.trim() ? "default" : "ghost"}
                    aria-label="Send"
                    disabled={!input.trim()}
                  >
                    <Send className="size-4" />
                  </Button>
                )}
              </div>
            </form>
          </div>
        </Card>
      </div>

      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Chat history"
      >
        <div className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search chat history"
              placeholder="Search by topic or keyword"
              className="pl-9"
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={`w-full rounded-2xl border px-3 py-3 text-left text-sm transition ${
                  activeSessionId === session.id
                    ? "border-primary bg-primary/5"
                    : "border-border/70 bg-background hover:border-primary/30"
                }`}
                onClick={() => openSession(session.id)}
              >
                <p className="font-medium">{session.title}</p>
              </button>
            ))}

            {sessions.length === 0 ? (
              <EmptyState
                icon={<Clock className="size-5" />}
                title="No chat history yet"
                description="Start first workspace conversation to create saved history."
              />
            ) : null}
          </div>

          {sessionLoadError ? (
            <StatusBanner
              variant="error"
              title="Failed to load sessions"
              description={sessionLoadError}
            />
          ) : null}
        </div>
      </Modal>

      <Modal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        title="Message templates"
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Fill in the blanks for a clear, retrieval-friendly prompt.
          </p>
          {messageTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-left text-sm transition hover:border-primary/30"
              onClick={() => applyTemplate(template)}
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline">{template.team}</Badge>
                <p className="font-medium">{template.title}</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {template.body}
              </p>
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={savedMessagesOpen}
        onClose={() => setSavedMessagesOpen(false)}
        title="Saved refined messages"
      >
        <div className="space-y-3">
          {savedMessages.map((message) => (
            <button
              key={message.id}
              type="button"
              className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-left text-sm transition hover:border-primary/30"
              onClick={() => applySavedMessage(message)}
            >
              <p className="font-medium line-clamp-2">{message.refinedText}</p>
              <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                Original: {message.originalText}
              </p>
            </button>
          ))}

          {savedMessages.length === 0 ? (
            <EmptyState
              icon={<Bookmark className="size-5" />}
              title="No saved messages yet"
              description="Refine a message and save it for reuse."
            />
          ) : null}
        </div>
      </Modal>
        </>
      )}
    </AppShell>
  );
}
