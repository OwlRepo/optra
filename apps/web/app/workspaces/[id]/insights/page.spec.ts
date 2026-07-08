/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@repo/ui";
import WorkspaceInsightsPage from "./page";

const pushMock = vi.fn();
const routerMock = { push: pushMock };
const listFreshnessFlagsMock = vi.fn();
const dismissFreshnessFlagMock = vi.fn();
const listFaqDraftsMock = vi.fn();
const approveFaqDraftMock = vi.fn();
const rejectFaqDraftMock = vi.fn();
const getWorkspaceMock = vi.fn();
const logoutMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => "/workspaces/ws-1/insights",
}));

vi.mock("@/lib/api/insights", () => ({
  listFreshnessFlags: (...args: unknown[]) => listFreshnessFlagsMock(...args),
  dismissFreshnessFlag: (...args: unknown[]) => dismissFreshnessFlagMock(...args),
  listFaqDrafts: (...args: unknown[]) => listFaqDraftsMock(...args),
  approveFaqDraft: (...args: unknown[]) => approveFaqDraftMock(...args),
  rejectFaqDraft: (...args: unknown[]) => rejectFaqDraftMock(...args),
}));

vi.mock("@/lib/api/workspaces", () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
}));

vi.mock("@/lib/api/auth", () => ({
  logout: (...args: unknown[]) => logoutMock(...args),
}));

vi.mock("@/lib/api/events", () => ({
  getUnreadCount: () => Promise.resolve({ count: 0 }),
}));

function renderPage() {
  return render(
    React.createElement(
      ToastProvider,
      undefined,
      React.createElement(WorkspaceInsightsPage, { params: { id: "ws-1" } }),
    ),
  );
}

describe("WorkspaceInsightsPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    listFreshnessFlagsMock.mockReset();
    dismissFreshnessFlagMock.mockReset();
    listFaqDraftsMock.mockReset();
    approveFaqDraftMock.mockReset();
    rejectFaqDraftMock.mockReset();
    getWorkspaceMock.mockReset();
    logoutMock.mockReset();
    getWorkspaceMock.mockResolvedValue({ id: "ws-1", name: "Acme Support" });
    listFreshnessFlagsMock.mockResolvedValue([]);
    listFaqDraftsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders an empty state when there are no flags", async () => {
    renderPage();

    expect(await screen.findByText("No freshness flags")).toBeDefined();
  });

  it("lists flags with document title and score", async () => {
    listFreshnessFlagsMock.mockResolvedValue([
      {
        id: "flag-1",
        documentId: "doc-1",
        documentTitle: "Refund Policy",
        ticketId: "tkt-1",
        score: 0.234,
        reason: "ticket-mismatch",
        createdAt: "",
      },
    ]);

    renderPage();

    expect(await screen.findByText("Refund Policy")).toBeDefined();
    expect(screen.getByText("ticket-mismatch")).toBeDefined();
    expect(screen.getByText("Match score 0.23 against a recent ticket")).toBeDefined();
  });

  it("dismisses a flag and removes it from the list", async () => {
    listFreshnessFlagsMock.mockResolvedValue([
      {
        id: "flag-1",
        documentId: "doc-1",
        documentTitle: "Refund Policy",
        ticketId: null,
        score: null,
        reason: "ticket-mismatch",
        createdAt: "",
      },
    ]);
    dismissFreshnessFlagMock.mockResolvedValue({ id: "flag-1", dismissed: true });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss flag for Refund Policy" }));

    await waitFor(() => {
      expect(dismissFreshnessFlagMock).toHaveBeenCalledWith("ws-1", "flag-1");
    });
    expect(await screen.findByText("No freshness flags")).toBeDefined();
  });

  it("redirects to login when listing flags returns unauthorized", async () => {
    listFreshnessFlagsMock.mockRejectedValue({ message: "Unauthorized" });

    renderPage();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/login");
    });
  });

  it("switches to the FAQ drafts tab and lists drafts", async () => {
    listFaqDraftsMock.mockResolvedValue([
      { id: "draft-1", question: "Why can't I log in?", answer: "Check your credentials.", clusterSize: 4, createdAt: "" },
    ]);

    renderPage();
    await screen.findByText("No freshness flags");

    fireEvent.click(screen.getByRole("button", { name: "FAQ drafts" }));

    expect(await screen.findByText("Why can't I log in?")).toBeDefined();
    expect(screen.getByText("4 tickets")).toBeDefined();
  });

  it("approves a draft and removes it from the list", async () => {
    listFaqDraftsMock.mockResolvedValue([
      { id: "draft-1", question: "Why can't I log in?", answer: "Check your credentials.", clusterSize: 4, createdAt: "" },
    ]);
    approveFaqDraftMock.mockResolvedValue({ id: "draft-1", status: "approved" });

    renderPage();
    await screen.findByText("No freshness flags");
    fireEvent.click(screen.getByRole("button", { name: "FAQ drafts" }));
    await screen.findByText("Why can't I log in?");

    fireEvent.click(screen.getByRole("button", { name: "Approve FAQ: Why can't I log in?" }));

    await waitFor(() => {
      expect(approveFaqDraftMock).toHaveBeenCalledWith("ws-1", "draft-1");
    });
    expect(await screen.findByText("No FAQ drafts")).toBeDefined();
  });

  it("rejects a draft and removes it from the list", async () => {
    listFaqDraftsMock.mockResolvedValue([
      { id: "draft-1", question: "Why can't I log in?", answer: "Check your credentials.", clusterSize: 4, createdAt: "" },
    ]);
    rejectFaqDraftMock.mockResolvedValue({ id: "draft-1", status: "rejected" });

    renderPage();
    await screen.findByText("No freshness flags");
    fireEvent.click(screen.getByRole("button", { name: "FAQ drafts" }));
    await screen.findByText("Why can't I log in?");

    fireEvent.click(screen.getByRole("button", { name: "Reject FAQ: Why can't I log in?" }));

    await waitFor(() => {
      expect(rejectFaqDraftMock).toHaveBeenCalledWith("ws-1", "draft-1");
    });
    expect(await screen.findByText("No FAQ drafts")).toBeDefined();
  });
});
