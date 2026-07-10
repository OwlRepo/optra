/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@repo/ui";
import WorkspaceChatPage from "./page";

const pushMock = vi.fn();
const routerMock = { push: pushMock };
const listChatSessionsMock = vi.fn();
const getChatMessagesMock = vi.fn();
const getWorkspaceMock = vi.fn();
const setMessagesMock = vi.fn();
const handleSubmitMock = vi.fn();
const reloadMock = vi.fn();
const setInputMock = vi.fn();
const downloadDocumentMock = vi.fn();
const downloadTicketTranscriptMock = vi.fn();
const logoutMock = vi.fn();
const refineMessageMock = vi.fn();
const getRefineStatusMock = vi.fn();
const saveRefinedMessageMock = vi.fn();
const listSavedRefinedMessagesMock = vi.fn();
let latestUseChatOptions: any = null;
let mockMessages = [{ id: "assistant-1", role: "assistant", content: "Grounded answer" }];
let shouldEmitAssistantReply = true;
let mockIsLoading = false;
let mockStructuredHeaders: Record<string, string> = {};

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => "/workspaces/ws-1/chat",
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/api/chat", () => ({
  listChatSessions: (...args: unknown[]) => listChatSessionsMock(...args),
  getChatMessages: (...args: unknown[]) => getChatMessagesMock(...args),
}));

vi.mock("@/lib/api/documents", () => ({
  downloadDocument: (...args: unknown[]) => downloadDocumentMock(...args),
}));

vi.mock("@/lib/api/tickets", () => ({
  downloadTicketTranscript: (...args: unknown[]) => downloadTicketTranscriptMock(...args),
}));

vi.mock("@/lib/api/workspaces", () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
}));

vi.mock("@/lib/api/auth", () => ({
  logout: (...args: unknown[]) => logoutMock(...args),
}));

vi.mock("@/lib/api/refine", () => ({
  refineMessage: (...args: unknown[]) => refineMessageMock(...args),
  getRefineStatus: (...args: unknown[]) => getRefineStatusMock(...args),
  saveRefinedMessage: (...args: unknown[]) => saveRefinedMessageMock(...args),
  listSavedRefinedMessages: (...args: unknown[]) => listSavedRefinedMessagesMock(...args),
}));

// StreamingText/ThinkingIndicator pull in the real GSAP/ogl/motion-backed
// reactbits components, which self-register global ScrollTrigger listeners at
// import time (their own animation behavior is covered separately by
// streaming-text.spec.ts and thinking-indicator.spec.ts, each with the
// vendored component mocked). Mocking them here keeps this page-level test
// about this page's own logic and avoids leaking GSAP globals across test
// files in the same worker.
vi.mock("@/components/chat/streaming-text", () => ({
  StreamingText: ({ text }: { text: string }) => text,
}));

vi.mock("@/components/chat/thinking-indicator", () => ({
  ThinkingIndicator: ({ label }: { label: string }) => label,
}));

vi.mock("ai/react", async () => {
  const ReactModule = await import("react");

  return {
    useChat: (options: any) => {
      latestUseChatOptions = options;
      const [messages, setMessagesState] = ReactModule.useState(mockMessages);
      const [inputValue, setInputValue] = ReactModule.useState("");
      const firedRef = ReactModule.useRef(false);

      ReactModule.useEffect(() => {
        if (firedRef.current) {
          return;
        }

        firedRef.current = true;
        setMessagesMock.mockImplementation((value: any) => {
          if (typeof value === "function") {
            setMessagesState((current) => value(current));
          } else {
            setMessagesState(value);
          }
        });

        if (shouldEmitAssistantReply) {
          void options.onResponse?.(
            new Response(null, {
              headers: {
                "X-Chat-Sources": encodeURIComponent(
                  JSON.stringify([
                    {
                      documentId: "doc-1",
                      knowledgeBaseId: "kb-1",
                      title: "Support SOP",
                      sourceUrl: "https://example.com/sop",
                      score: 0.88,
                      snippet: "Grounded excerpt",
                    },
                  ]),
                ),
                "X-Chat-Session-Id": "session-1",
                ...mockStructuredHeaders,
              },
            }),
          );

          void options.onFinish?.({ id: "assistant-1", role: "assistant", content: "Grounded answer" });
        }
      }, [options]);

      return {
        messages,
        setMessages: setMessagesMock,
        input: inputValue,
        setInput: (value: string) => {
          setInputValue(value);
          setInputMock(value);
        },
        handleInputChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
          setInputValue(event.target.value),
        handleSubmit: handleSubmitMock,
        isLoading: mockIsLoading,
        error: undefined,
        reload: reloadMock,
        stop: vi.fn(),
      };
    },
  };
});

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(WorkspaceChatPage, {
        params: { id: "ws-1" },
      }),
    ),
  );
}

describe("WorkspaceChatPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    listChatSessionsMock.mockReset();
    getChatMessagesMock.mockReset();
    getWorkspaceMock.mockReset();
    setMessagesMock.mockReset();
    handleSubmitMock.mockReset();
    reloadMock.mockReset();
    setInputMock.mockReset();
    downloadDocumentMock.mockReset();
    downloadTicketTranscriptMock.mockReset();
    logoutMock.mockReset();
    refineMessageMock.mockReset();
    getRefineStatusMock.mockReset();
    saveRefinedMessageMock.mockReset();
    listSavedRefinedMessagesMock.mockReset();
    getRefineStatusMock.mockResolvedValue({ used: 0, limit: 20, remaining: 20 });
    listSavedRefinedMessagesMock.mockResolvedValue({ items: [] });
    latestUseChatOptions = null;
    mockMessages = [{ id: "assistant-1", role: "assistant", content: "Grounded answer" }];
    shouldEmitAssistantReply = true;
    mockIsLoading = false;
    mockSearchParams = new URLSearchParams();
    mockStructuredHeaders = {};
    getWorkspaceMock.mockResolvedValue({ id: "ws-1", name: "Acme Support" });
    listChatSessionsMock.mockResolvedValue({
      items: [{ id: "session-1", title: "Billing help", createdAt: "", updatedAt: "" }],
      page: 1,
      pageSize: 5,
      total: 1,
      totalPages: 1,
    });
    getChatMessagesMock.mockResolvedValue({
      items: [
        { id: "user-1", role: "user", content: "Past question", createdAt: "" },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Grounded answer",
          createdAt: "",
          sources: [
            {
              sourceType: "document",
              documentId: "doc-1",
              knowledgeBaseId: "kb-1",
              title: "Support SOP",
              sourceUrl: "https://example.com/sop",
              score: 0.88,
              snippet: "Grounded excerpt",
            },
          ],
        },
      ],
      nextCursor: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a textarea for the message input instead of a single-line input", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Ask a workspace question/).tagName).toBe("TEXTAREA");
    });
  });

  it("sends the message on Enter and does not submit on Shift+Enter", async () => {
    renderPage();

    const textarea = await screen.findByPlaceholderText(/Ask a workspace question/);
    fireEvent.change(textarea, { target: { value: "How do refunds work?" } });

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(handleSubmitMock).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    await waitFor(() => {
      expect(handleSubmitMock).toHaveBeenCalled();
    });
  });

  it("shows a cycling thinking placeholder while waiting for the assistant", async () => {
    mockMessages = [];
    mockIsLoading = true;
    shouldEmitAssistantReply = false;

    renderPage();

    expect(await screen.findByText(/Thinking…|Noodling…|Digging through the docs…|Connecting the dots…|Almost there…/)).toBeDefined();
  });

  it("shows history in a modal (not a side panel) and closes it after picking a session", async () => {
    renderPage();

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "History" }));

    expect(await screen.findByRole("dialog")).toBeDefined();
    expect(screen.getByText("Billing help")).toBeDefined();

    fireEvent.click(screen.getByText("Billing help"));

    await waitFor(() => {
      expect(getChatMessagesMock).toHaveBeenCalledWith("ws-1", "session-1");
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("searches chat history by keyword through the backend", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "History" }));
    await screen.findByRole("dialog");

    fireEvent.change(screen.getByLabelText("Search chat history"), { target: { value: "billing" } });

    await waitFor(() => {
      expect(listChatSessionsMock).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({ q: "billing", pageSize: 5 }),
      );
    });
  });

  it("hides relevance scores by default and reveals them on toggle", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Sources (1)" }));
    await waitFor(() => {
      expect(screen.getByText("Support SOP")).toBeDefined();
    });
    expect(screen.queryByText("0.88")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show relevance scores" }));
    expect(await screen.findByText("0.88")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Hide relevance scores" }));
    await waitFor(() => {
      expect(screen.queryByText("0.88")).toBeNull();
    });
  });

  it("renders sources under the assistant message rather than in a side column", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Sources (1)")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: "Sources (1)" }));
    await waitFor(() => {
      expect(screen.getByText("Support SOP")).toBeDefined();
    });
    expect(screen.queryByText("Latest assistant citations")).toBeNull();
  });

  it("downloads a document source that carries a knowledge base id", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Sources (1)" }));
    await screen.findByText("Support SOP");
    fireEvent.click(screen.getByRole("button", { name: "Download document" }));

    expect(downloadDocumentMock).toHaveBeenCalledWith("ws-1", "kb-1", "doc-1");
  });

  it("does not render a download button for a legacy document source without a knowledge base id", async () => {
    getChatMessagesMock.mockResolvedValueOnce({
      items: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Grounded answer",
          createdAt: "",
          sources: [
            {
              documentId: "doc-legacy",
              title: "Legacy doc",
              sourceUrl: "https://example.com/legacy",
              score: 0.7,
              snippet: "Legacy excerpt",
            },
          ],
        },
      ],
      nextCursor: null,
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Sources (1)" }));
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Legacy doc" })).toBeDefined();
    });
    expect(screen.queryByRole("button", { name: "Download document" })).toBeNull();
  });

  it("renders a PDF download button for a ticket citation and downloads the transcript", async () => {
    getChatMessagesMock.mockResolvedValueOnce({
      items: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Grounded answer",
          createdAt: "",
          sources: [
            {
              sourceType: "ticket",
              ticketId: "ticket-1",
              title: "Ticket citation",
              score: 0.77,
              snippet: "Ticket excerpt",
            },
          ],
        },
      ],
      nextCursor: null,
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Sources (1)" }));
    await waitFor(() => {
      expect(screen.getByText("Ticket citation")).toBeDefined();
    });
    expect(screen.queryByRole("link", { name: "Ticket citation" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Download transcript (PDF)" }));
    expect(downloadTicketTranscriptMock).toHaveBeenCalledWith("ws-1", "ticket-1");
  });

  it("opens the message templates modal and applies a template to the input", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Message templates" }));
    expect(await screen.findByText("Refund request")).toBeDefined();

    fireEvent.click(screen.getByText("Refund request"));

    await waitFor(() => {
      expect(setInputMock).toHaveBeenCalledWith(expect.stringContaining("{{customer_name}}"));
      expect(screen.queryByText("Refund request")).toBeNull();
    });
  });

  it("shows New chat as a primary button with a plus icon", async () => {
    renderPage();

    // The desktop actions bar and the mobile compact header both render a
    // "New chat" button (split only by CSS breakpoint) — both carry the icon.
    const buttons = await screen.findAllByRole("button", { name: "New chat" });
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.querySelector("svg.lucide-plus")).not.toBeNull();
    }
  });

  it("opens the session named in ?session= on mount (deep link from global search)", async () => {
    mockSearchParams = new URLSearchParams({ session: "session-1" });

    renderPage();

    await waitFor(() => {
      expect(getChatMessagesMock).toHaveBeenCalledWith("ws-1", "session-1");
    });
  });

  it("loads session history and new chat clears session body", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByText("Billing help"));

    await waitFor(() => {
      expect(getChatMessagesMock).toHaveBeenCalledWith("ws-1", "session-1");
    });

    expect(latestUseChatOptions.body).toEqual({ sessionId: "session-1" });

    fireEvent.click(screen.getAllByRole("button", { name: "New chat" })[0]);

    await waitFor(() => {
      expect(setMessagesMock).toHaveBeenCalled();
      expect(latestUseChatOptions.body).toBeUndefined();
    });
  });

  it("renders load more messages button and prepends older message page", async () => {
    getChatMessagesMock
      .mockResolvedValueOnce({
        items: [
          {
            id: "assistant-1",
            role: "assistant",
            content: "Grounded answer",
            createdAt: "",
            sources: [
              {
                sourceType: "document",
                documentId: "doc-1",
                knowledgeBaseId: "kb-1",
                title: "Support SOP",
                sourceUrl: "https://example.com/sop",
                score: 0.88,
                snippet: "Grounded excerpt",
              },
            ],
          },
        ],
        nextCursor: "msg-cursor-1",
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: "assistant-1",
            role: "assistant",
            content: "Grounded answer",
            createdAt: "",
            sources: [
              {
                sourceType: "document",
                documentId: "doc-1",
                knowledgeBaseId: "kb-1",
                title: "Support SOP",
                sourceUrl: "https://example.com/sop",
                score: 0.88,
                snippet: "Grounded excerpt",
              },
            ],
          },
        ],
        nextCursor: "msg-cursor-1",
      })
      .mockResolvedValueOnce({
        items: [{ id: "user-older", role: "user", content: "Earlier question", createdAt: "" }],
        nextCursor: null,
      });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByText("Billing help"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Load older messages" })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));

    await waitFor(() => {
      expect(getChatMessagesMock).toHaveBeenNthCalledWith(3, "ws-1", "session-1", {
        cursor: "msg-cursor-1",
      });
      expect(screen.getByText("Earlier question")).toBeDefined();
      expect(screen.getByText("Grounded answer")).toBeDefined();
    });
  });

  it("logs out and redirects to login", async () => {
    logoutMock.mockResolvedValue(undefined);

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Log out" }));

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/login");
    });
  });

  it("renders app shell title/action and workspace nav active on chat route", async () => {
    renderPage();

    // The chat page is mobile-full-bleed: the desktop title header and the
    // compact mobile header both render "Workspace assistant" (split only by
    // CSS breakpoint), so at least one match is what we're asserting.
    expect((await screen.findAllByText("Workspace assistant")).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "New chat" }).length).toBeGreaterThan(0);
    // The desktop sidebar nav renders a "Chat" link; confirm it (and any
    // other instance) agrees this route is active.
    const chatLinks = screen.getAllByRole("link", { name: "Chat" });
    expect(chatLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of chatLinks) {
      expect(link.getAttribute("aria-current")).toBe("page");
    }
  });

  it("renders real workspace name in sidebar header", async () => {
    renderPage();

    expect(await screen.findAllByText("Acme Support")).not.toHaveLength(0);
    expect(screen.getByText("A")).toBeDefined();
    expect(screen.queryByText("Workspace")).toBeNull();
  });

  it("redirects to login when workspace fetch is unauthorized", async () => {
    getWorkspaceMock.mockRejectedValue({ statusCode: 401, message: "Unauthorized" });

    renderPage();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/login");
    });
  });

  it("hides retry button and shows the empty state when there is no assistant answer yet", async () => {
    mockMessages = [];
    shouldEmitAssistantReply = false;

    renderPage();

    expect(await screen.findByText("Start workspace chat")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Retry last answer" })).toBeNull();
  });

  it("shows the remaining-refines badge from the status endpoint on mount", async () => {
    getRefineStatusMock.mockResolvedValue({ used: 5, limit: 20, remaining: 15 });

    renderPage();

    // Compact icon toolbar: the count renders as a small numeric badge next
    // to the "Refine with Optra" icon button, not as verbose text anymore.
    const refineButton = await screen.findByRole("button", { name: "Refine with Optra" });
    expect(within(refineButton.parentElement as HTMLElement).getByText("15")).toBeDefined();
  });

  it("clicking Refine with Optra calls refine and replaces textarea content with refined text", async () => {
    refineMessageMock.mockResolvedValue({ original: "raw draft", refined: "Clean refined text" });

    renderPage();

    const textarea = await screen.findByPlaceholderText(/Ask a workspace question/);
    fireEvent.change(textarea, { target: { value: "raw draft" } });

    fireEvent.click(await screen.findByRole("button", { name: "Refine with Optra" }));

    await waitFor(() => {
      expect(refineMessageMock).toHaveBeenCalledWith("ws-1", "raw draft");
      expect(setInputMock).toHaveBeenCalledWith("Clean refined text");
    });
  });

  it("shows Undo refine after a successful refine, and clicking it restores the original text", async () => {
    refineMessageMock.mockResolvedValue({ original: "raw draft", refined: "Clean refined text" });

    renderPage();

    const textarea = await screen.findByPlaceholderText(/Ask a workspace question/);
    fireEvent.change(textarea, { target: { value: "raw draft" } });
    fireEvent.click(await screen.findByRole("button", { name: "Refine with Optra" }));

    fireEvent.click(await screen.findByRole("button", { name: "Undo refine" }));

    await waitFor(() => {
      expect(setInputMock).toHaveBeenLastCalledWith("raw draft");
    });
  });

  it("hand-editing the textarea after a refine hides the Undo/Save affordances", async () => {
    refineMessageMock.mockResolvedValue({ original: "raw draft", refined: "Clean refined text" });

    renderPage();

    const textarea = await screen.findByPlaceholderText(/Ask a workspace question/);
    fireEvent.change(textarea, { target: { value: "raw draft" } });
    fireEvent.click(await screen.findByRole("button", { name: "Refine with Optra" }));
    await screen.findByRole("button", { name: "Undo refine" });

    fireEvent.change(textarea, { target: { value: "Clean refined text, but hand-edited" } });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Undo refine" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Save refined message" })).toBeNull();
    });
  });

  it("clicking Save refined message calls the save API with the last refine pair", async () => {
    refineMessageMock.mockResolvedValue({ original: "raw draft", refined: "Clean refined text" });
    saveRefinedMessageMock.mockResolvedValue({
      id: "m-1",
      originalText: "raw draft",
      refinedText: "Clean refined text",
      createdAt: "",
    });

    renderPage();

    const textarea = await screen.findByPlaceholderText(/Ask a workspace question/);
    fireEvent.change(textarea, { target: { value: "raw draft" } });
    fireEvent.click(await screen.findByRole("button", { name: "Refine with Optra" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save refined message" }));

    await waitFor(() => {
      expect(saveRefinedMessageMock).toHaveBeenCalledWith("ws-1", {
        originalText: "raw draft",
        refinedText: "Clean refined text",
      });
    });
  });

  it("shows an error toast with try-rephrasing copy on a 422 refine response", async () => {
    refineMessageMock.mockRejectedValue({
      message: "Refine produced no output. Try rephrasing.",
    });

    renderPage();

    const textarea = await screen.findByPlaceholderText(/Ask a workspace question/);
    fireEvent.change(textarea, { target: { value: "raw draft" } });
    fireEvent.click(await screen.findByRole("button", { name: "Refine with Optra" }));

    expect(await screen.findByText("Refine produced no output. Try rephrasing.")).toBeDefined();
  });

  it("shows an error toast mentioning the daily limit on a 429 refine response", async () => {
    refineMessageMock.mockRejectedValue({ message: "Daily refine limit reached" });

    renderPage();

    const textarea = await screen.findByPlaceholderText(/Ask a workspace question/);
    fireEvent.change(textarea, { target: { value: "raw draft" } });
    fireEvent.click(await screen.findByRole("button", { name: "Refine with Optra" }));

    expect(await screen.findByText("Daily refine limit reached")).toBeDefined();
  });

  it("opens the Saved messages modal and lists fetched saved messages", async () => {
    listSavedRefinedMessagesMock.mockResolvedValue({
      items: [
        { id: "m-1", originalText: "raw one", refinedText: "Reusable refined text", createdAt: "" },
      ],
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Saved messages" }));

    expect(await screen.findByRole("dialog")).toBeDefined();
    expect(screen.getByText("Reusable refined text")).toBeDefined();
  });

  it("renders an empty state in the Saved messages modal when there are no saved messages", async () => {
    listSavedRefinedMessagesMock.mockResolvedValue({ items: [] });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Saved messages" }));

    expect(await screen.findByText(/No saved messages yet/)).toBeDefined();
  });

  it("selecting a saved message pastes its refinedText into the textarea and closes the modal", async () => {
    listSavedRefinedMessagesMock.mockResolvedValue({
      items: [
        { id: "m-1", originalText: "raw one", refinedText: "Reusable refined text", createdAt: "" },
      ],
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Saved messages" }));
    fireEvent.click(await screen.findByText("Reusable refined text"));

    await waitFor(() => {
      expect(setInputMock).toHaveBeenCalledWith("Reusable refined text");
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("renders clickable dataset candidates for an ambiguous structured answer", async () => {
    mockStructuredHeaders = {
      "X-Chat-Structured-State": "ambiguous",
      "X-Chat-Structured-Candidates": encodeURIComponent(
        JSON.stringify([
          { id: "ds-1", name: "Sales 2024", description: null },
          { id: "ds-2", name: "Sales 2025", description: null },
        ]),
      ),
    };

    renderPage();

    expect(await screen.findByText("Which dataset did you mean?")).toBeDefined();
    fireEvent.click(await screen.findByRole("button", { name: "Sales 2024" }));

    expect(setInputMock).toHaveBeenCalledWith('Use the "Sales 2024" dataset');
  });

  it("renders a correction hint for a failed structured query", async () => {
    mockStructuredHeaders = { "X-Chat-Structured-State": "correction" };

    renderPage();

    expect(
      await screen.findByText("Couldn't run that query — try rephrasing"),
    ).toBeDefined();
  });

  it("renders an empty-dataset hint when no dataset matches", async () => {
    mockStructuredHeaders = { "X-Chat-Structured-State": "empty" };

    renderPage();

    expect(
      await screen.findByText("No matching dataset for this question"),
    ).toBeDefined();
  });
});
