/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@repo/ui";
import WorkspaceDatasetsPage from "./page";

const pushMock = vi.fn();
const routerMock = { push: pushMock };
const listDatasetsMock = vi.fn();
const uploadDatasetMock = vi.fn();
const deleteDatasetMock = vi.fn();
const getWorkspaceMock = vi.fn();
const logoutMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => "/workspaces/ws-1/datasets",
}));

vi.mock("@/lib/api/datasets", () => ({
  listDatasets: (...args: unknown[]) => listDatasetsMock(...args),
  uploadDataset: (...args: unknown[]) => uploadDatasetMock(...args),
  deleteDataset: (...args: unknown[]) => deleteDatasetMock(...args),
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
      React.createElement(WorkspaceDatasetsPage, { params: { id: "ws-1" } }),
    ),
  );
}

describe("WorkspaceDatasetsPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    listDatasetsMock.mockReset();
    uploadDatasetMock.mockReset();
    deleteDatasetMock.mockReset();
    getWorkspaceMock.mockReset();
    logoutMock.mockReset();
    getWorkspaceMock.mockResolvedValue({ id: "ws-1", name: "Acme Support" });
    listDatasetsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders an empty state when there are no datasets", async () => {
    renderPage();

    expect(await screen.findByText("No datasets yet")).toBeDefined();
  });

  it("lists datasets with status badges and row counts", async () => {
    listDatasetsMock.mockResolvedValue([
      {
        id: "ds-1",
        name: "sales.csv",
        status: "done",
        rowCount: 42,
        description: "Dataset with columns: product, revenue.",
        lastError: null,
        createdAt: "",
      },
      {
        id: "ds-2",
        name: "refunds.csv",
        status: "failed",
        rowCount: null,
        description: null,
        lastError: "Embedding service unavailable",
        createdAt: "",
      },
    ]);

    renderPage();

    expect(await screen.findByText("sales.csv")).toBeDefined();
    expect(screen.getByText("Ready")).toBeDefined();
    expect(screen.getByText("42 rows")).toBeDefined();
    expect(screen.getByText("refunds.csv")).toBeDefined();
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("Embedding service unavailable")).toBeDefined();
  });

  it("uploads a selected file and refreshes the list", async () => {
    uploadDatasetMock.mockResolvedValue({ id: "ds-1", name: "sales.csv", status: "pending" });

    renderPage();
    await screen.findByText("No datasets yet");

    const file = new File(["product,revenue\nWidget,1000"], "sales.csv", { type: "text/csv" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadDatasetMock).toHaveBeenCalledWith("ws-1", file);
    });
    expect(listDatasetsMock).toHaveBeenCalledTimes(2);
  });

  it("deletes a dataset and removes it from the list", async () => {
    listDatasetsMock.mockResolvedValue([
      {
        id: "ds-1",
        name: "sales.csv",
        status: "done",
        rowCount: 2,
        description: "desc",
        lastError: null,
        createdAt: "",
      },
    ]);
    deleteDatasetMock.mockResolvedValue({ message: "Dataset deleted" });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Delete sales.csv" }));

    await waitFor(() => {
      expect(deleteDatasetMock).toHaveBeenCalledWith("ws-1", "ds-1");
    });
    expect(await screen.findByText("No datasets yet")).toBeDefined();
  });

  it("redirects to login when listing datasets returns unauthorized", async () => {
    listDatasetsMock.mockRejectedValue({ message: "Unauthorized" });

    renderPage();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/login");
    });
  });
});
