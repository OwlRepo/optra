"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageSection,
  Pagination,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@repo/ui";
import { Download, FileUp, Search, Trash2 } from "lucide-react";
import {
  deleteDocument,
  deleteDocuments,
  downloadDocument,
  downloadDocuments,
  listDocuments,
  uploadDocument,
} from "@/lib/api/documents";
import { logout } from "@/lib/api/auth";
import { listScrapeRuns, scrapeSite } from "@/lib/api/scrape";
import { isUnauthorized } from "@/lib/api/handle-unauthorized";
import { getWorkspace, listWorkspaces } from "@/lib/api/workspaces";
import { WorkspaceNav, workspacePrimaryTabItems } from "@/components/workspace-nav";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { WorkspaceBrandLink } from "@/components/workspace-brand-link";

type DocumentRow = {
  id: string;
  title: string;
  status: "pending" | "processing" | "done" | "failed";
  createdAt?: string;
  updatedAt?: string;
};

type DocumentListResponse = {
  items: DocumentRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type WorkspaceMembership = {
  id: string;
  role: "owner" | "admin" | "member";
};

type ScrapeRunRow = {
  id: string;
  seedUrl: string;
  status: "queued" | "running" | "completed" | "failed";
  pagesFound: number;
  pagesSucceeded: number;
  pagesFailed: number;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt?: string;
};

type ScrapeRunListResponse = {
  items: ScrapeRunRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type DocumentStatusFilter = "" | DocumentRow["status"];
type ScrapeStatusFilter = "" | ScrapeRunRow["status"];

const statusVariant: Record<
  DocumentRow["status"],
  "secondary" | "success" | "destructive"
> = {
  pending: "secondary",
  processing: "secondary",
  done: "success",
  failed: "destructive",
};

function getScrapeStatusLabel(run: ScrapeRunRow) {
  if (run.status === "completed") {
    return "Completed";
  }

  if (run.status === "failed") {
    return "Failed";
  }

  return "In progress";
}

function getScrapeCountLabel(run: ScrapeRunRow) {
  return `Found ${run.pagesFound} · Queued ${run.pagesSucceeded} · Page errors ${run.pagesFailed}`;
}

function getScrapeProgressLabel(run: ScrapeRunRow) {
  if (
    run.pagesFound <= 0 ||
    (run.status !== "running" && run.status !== "completed")
  ) {
    return null;
  }

  const processed = run.pagesSucceeded + run.pagesFailed;
  const percent = Math.round((processed / run.pagesFound) * 100);

  return `${percent}% of discovered pages processed`;
}

export default function KnowledgeBasePage({
  params,
}: {
  params: { id: string; kbId: string };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const toastRef = React.useRef(toast);
  const workspaceId = params.id;
  const knowledgeBaseId = params.kbId;
  const [documents, setDocuments] = React.useState<DocumentRow[]>([]);
  const [documentMeta, setDocumentMeta] = React.useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  const [documentPage, setDocumentPage] = React.useState(1);
  const [documentPageSize, setDocumentPageSize] = React.useState(20);
  const [documentSearch, setDocumentSearch] = React.useState("");
  const [debouncedDocumentSearch, setDebouncedDocumentSearch] = React.useState("");
  const [documentStatusFilter, setDocumentStatusFilter] =
    React.useState<DocumentStatusFilter>("");
  const [selectedDocumentIds, setSelectedDocumentIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [scrapeRuns, setScrapeRuns] = React.useState<ScrapeRunRow[]>([]);
  const [scrapeRunMeta, setScrapeRunMeta] = React.useState({
    page: 1,
    pageSize: 5,
    total: 0,
    totalPages: 0,
  });
  const [scrapeRunPage, setScrapeRunPage] = React.useState(1);
  const [scrapeRunPageSize, setScrapeRunPageSize] = React.useState(5);
  const [scrapeRunSearch, setScrapeRunSearch] = React.useState("");
  const [debouncedScrapeRunSearch, setDebouncedScrapeRunSearch] = React.useState("");
  const [scrapeRunStatusFilter, setScrapeRunStatusFilter] =
    React.useState<ScrapeStatusFilter>("");
  const [membership, setMembership] =
    React.useState<WorkspaceMembership | null>(null);
  const [workspace, setWorkspace] = React.useState<{
    id: string;
    name: string;
  } | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isScrapeRunsLoading, setIsScrapeRunsLoading] = React.useState(true);
  const [pendingDelete, setPendingDelete] = React.useState<DocumentRow | null>(
    null,
  );
  const [pendingBulkDelete, setPendingBulkDelete] = React.useState(false);
  const [isScrapeModalOpen, setIsScrapeModalOpen] = React.useState(false);
  const [isSubmittingScrape, setIsSubmittingScrape] = React.useState(false);
  const [isDocumentsRefreshing, setIsDocumentsRefreshing] = React.useState(false);
  const [isDownloadingSelected, setIsDownloadingSelected] = React.useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = React.useState(false);
  const [dragActive, setDragActive] = React.useState(false);
  const [scrapeUrl, setScrapeUrl] = React.useState("");
  const [scrapeMaxDepth, setScrapeMaxDepth] = React.useState("3");
  const [scrapeMaxPages, setScrapeMaxPages] = React.useState("100");
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const scrapeUrlInputRef = React.useRef<HTMLInputElement>(null);

  const canManage =
    membership?.role === "owner" || membership?.role === "admin";

  React.useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedDocumentSearch(documentSearch.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [documentSearch]);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedScrapeRunSearch(scrapeRunSearch.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [scrapeRunSearch]);

  React.useEffect(() => {
    setDocumentPage(1);
  }, [debouncedDocumentSearch, documentPageSize, documentStatusFilter]);

  React.useEffect(() => {
    setScrapeRunPage(1);
  }, [debouncedScrapeRunSearch, scrapeRunPageSize, scrapeRunStatusFilter]);

  const loadDocuments = React.useCallback(async () => {
    try {
      setIsDocumentsRefreshing(true);
      const data = (await listDocuments(
        workspaceId,
        knowledgeBaseId,
        {
          page: documentPage,
          pageSize: documentPageSize,
          q: debouncedDocumentSearch || undefined,
          status: documentStatusFilter || undefined,
        },
      )) as DocumentListResponse;
      const items = Array.isArray(data?.items) ? data.items : [];
      setDocuments(items);
      setDocumentMeta({
        page: data?.page ?? documentPage,
        pageSize: data?.pageSize ?? documentPageSize,
        total: data?.total ?? items.length,
        totalPages: data?.totalPages ?? (items.length === 0 ? 0 : 1),
      });
      setSelectedDocumentIds((current) => {
        const visible = new Set(items.map((item) => item.id));
        return new Set([...current].filter((id) => visible.has(id)));
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
        title: "Failed to load documents",
        description: message,
      });
    } finally {
      setIsLoading(false);
      setIsDocumentsRefreshing(false);
    }
  }, [
    debouncedDocumentSearch,
    documentPage,
    documentPageSize,
    documentStatusFilter,
    knowledgeBaseId,
    router,
    workspaceId,
  ]);

  const loadScrapeRuns = React.useCallback(async () => {
    try {
      setIsScrapeRunsLoading(true);
      const data = (await listScrapeRuns(
        workspaceId,
        knowledgeBaseId,
        {
          page: scrapeRunPage,
          pageSize: scrapeRunPageSize,
          q: debouncedScrapeRunSearch || undefined,
          status: scrapeRunStatusFilter || undefined,
        },
      )) as ScrapeRunListResponse;
      const items = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
          ? data
          : [];
      setScrapeRuns(items);
      setScrapeRunMeta({
        page: data?.page ?? scrapeRunPage,
        pageSize: data?.pageSize ?? scrapeRunPageSize,
        total: data?.total ?? items.length,
        totalPages: data?.totalPages ?? (items.length === 0 ? 0 : 1),
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
        title: "Failed to load crawl runs",
        description: message,
      });
    } finally {
      setIsScrapeRunsLoading(false);
    }
  }, [
    debouncedScrapeRunSearch,
    knowledgeBaseId,
    router,
    scrapeRunPage,
    scrapeRunPageSize,
    scrapeRunStatusFilter,
    workspaceId,
  ]);

  const loadMembership = React.useCallback(async () => {
    try {
      const memberships = await listWorkspaces();
      const items = Array.isArray(memberships?.items)
        ? memberships.items
        : [];
      setMembership(
        items.find(
          (entry: WorkspaceMembership) => entry.id === workspaceId,
        ) ?? null,
      );
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
      }
    }
  }, [router, workspaceId]);

  React.useEffect(() => {
    void Promise.all([
      loadDocuments(),
      loadMembership(),
      loadScrapeRuns(),
      getWorkspace(workspaceId)
        .then((data) => {
          setWorkspace(data);
        })
        .catch((err) => {
          if (isUnauthorized(err)) {
            router.push("/login");
            return null;
          }

          throw err;
        }),
    ]);
  }, [loadDocuments, loadMembership, loadScrapeRuns, router, workspaceId]);

  const handleLogout = React.useCallback(async () => {
    try {
      await logout();
    } finally {
      router.push("/login");
    }
  }, [router]);

  const hasInFlightDocuments = documents.some(
    (document) =>
      document.status === "pending" || document.status === "processing",
  );
  const pendingDocumentCount = documents.filter(
    (document) => document.status === "pending",
  ).length;
  const processingDocumentCount = documents.filter(
    (document) => document.status === "processing",
  ).length;
  const doneDocumentCount = documents.filter(
    (document) => document.status === "done",
  ).length;
  const failedDocumentCount = documents.filter(
    (document) => document.status === "failed",
  ).length;
  const inFlightDocumentCount =
    pendingDocumentCount + processingDocumentCount;
  const documentProgressPercent =
    documents.length === 0
      ? 0
      : Math.round((doneDocumentCount / documents.length) * 100);
  const hasInFlightRuns = scrapeRuns.some(
    (run) => run.status === "queued" || run.status === "running",
  );
  const selectedDocumentIdList = React.useMemo(
    () => Array.from(selectedDocumentIds),
    [selectedDocumentIds],
  );
  const allVisibleDocumentsSelected =
    documents.length > 0 && documents.every((document) => selectedDocumentIds.has(document.id));

  React.useEffect(() => {
    if (!isScrapeModalOpen) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      scrapeUrlInputRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isScrapeModalOpen]);

  React.useEffect(() => {
    if (!hasInFlightDocuments) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadDocuments();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasInFlightDocuments, loadDocuments]);

  React.useEffect(() => {
    if (!hasInFlightRuns) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadScrapeRuns();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasInFlightRuns, loadScrapeRuns]);

  const uploadFiles = React.useCallback(
    async (files: FileList | File[]) => {
      const fileList = Array.from(files);
      if (fileList.length === 0) {
        return;
      }

      for (const file of fileList) {
        const created = await uploadDocument(
          workspaceId,
          knowledgeBaseId,
          file,
        );
        setDocuments((current) => [
          {
            id: created.id,
            title: created.title,
            status: created.status,
            createdAt: new Date().toISOString(),
          },
          ...current,
        ]);
        toast({
          variant: "success",
          title: "Upload started",
          description: `${file.name} is queued for processing.`,
        });
      }
      void loadDocuments();
    },
    [knowledgeBaseId, loadDocuments, toast, workspaceId],
  );

  const handleUploadError = React.useCallback(
    (err: unknown) => {
        if (isUnauthorized(err)) {
          router.push("/login");
          return;
        }

        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Try again in a moment.";

        toast({
          variant: "error",
          title: "Upload failed",
          description: message,
        });
    },
    [router, toast],
  );

  const handleFileChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      try {
        await uploadFiles(event.target.files ?? []);
      } catch (err) {
        handleUploadError(err);
      } finally {
        event.target.value = "";
      }
    },
    [handleUploadError, uploadFiles],
  );

  const handleDrop = React.useCallback(
    async (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setDragActive(false);

      try {
        await uploadFiles(event.dataTransfer.files);
      } catch (err) {
        handleUploadError(err);
      }
    },
    [handleUploadError, uploadFiles],
  );

  const confirmDelete = React.useCallback(async () => {
    if (!pendingDelete) {
      return;
    }

    try {
      await deleteDocument(workspaceId, knowledgeBaseId, pendingDelete.id);
      toast({
        variant: "success",
        title: "Document deleted",
        description: `${pendingDelete.title} was removed.`,
      });
      setPendingDelete(null);
      await loadDocuments();
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
        return;
      }

      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Try again in a moment.";

      toast({
        variant: "error",
        title: "Failed to delete document",
        description: message,
      });
    }
  }, [
    knowledgeBaseId,
    loadDocuments,
    pendingDelete,
    router,
    toast,
    workspaceId,
  ]);

  const handleDownloadDocument = React.useCallback(
    async (document: DocumentRow) => {
      try {
        await downloadDocument(workspaceId, knowledgeBaseId, document.id);
      } catch (err) {
        if (isUnauthorized(err)) {
          router.push("/login");
          return;
        }

        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Try again in a moment.";

        toast({
          variant: "error",
          title: "Download failed",
          description: message,
        });
      }
    },
    [knowledgeBaseId, router, toast, workspaceId],
  );

  const handleDownloadSelected = React.useCallback(async () => {
    if (selectedDocumentIdList.length === 0) {
      return;
    }

    setIsDownloadingSelected(true);
    try {
      await downloadDocuments(workspaceId, knowledgeBaseId, selectedDocumentIdList);
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
        return;
      }

      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Try again in a moment.";

      toast({
        variant: "error",
        title: "Bulk download failed",
        description: message,
      });
    } finally {
      setIsDownloadingSelected(false);
    }
  }, [knowledgeBaseId, router, selectedDocumentIdList, toast, workspaceId]);

  const confirmBulkDelete = React.useCallback(async () => {
    if (selectedDocumentIdList.length === 0) {
      return;
    }

    setIsDeletingSelected(true);
    try {
      const result = (await deleteDocuments(
        workspaceId,
        knowledgeBaseId,
        selectedDocumentIdList,
      )) as { deleted: number; skipped: number };
      toast({
        variant: "success",
        title: "Documents deleted",
        description:
          result.skipped > 0
            ? `${result.deleted} deleted · ${result.skipped} skipped.`
            : `${result.deleted} deleted.`,
      });
      setPendingBulkDelete(false);
      setSelectedDocumentIds(new Set());
      await loadDocuments();
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
        return;
      }

      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Try again in a moment.";

      toast({
        variant: "error",
        title: "Failed to delete selected documents",
        description: message,
      });
    } finally {
      setIsDeletingSelected(false);
    }
  }, [
    knowledgeBaseId,
    loadDocuments,
    router,
    selectedDocumentIdList,
    toast,
    workspaceId,
  ]);

  const submitScrape = React.useCallback(async () => {
    setIsSubmittingScrape(true);

    try {
      const payload = {
        url: scrapeUrl,
        maxDepth: Number(scrapeMaxDepth),
        maxPages: Number(scrapeMaxPages),
      };

      const result = await scrapeSite(workspaceId, knowledgeBaseId, payload);
      setIsScrapeModalOpen(false);
      setScrapeUrl("");
      setScrapeMaxDepth("3");
      setScrapeMaxPages("100");
      toast({
        variant: "success",
        title: result.reusedExisting
          ? "Crawl already in progress"
          : "Crawl started",
        description: result.reusedExisting
          ? "Showing the existing crawl run for this URL."
          : "Website crawl queued for processing.",
      });
      await loadScrapeRuns();
      await loadDocuments();
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
        return;
      }

      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Try again in a moment.";

      toast({
        variant: "error",
        title: "Failed to start crawl",
        description: message,
      });
    } finally {
      setIsSubmittingScrape(false);
    }
  }, [
    knowledgeBaseId,
    loadDocuments,
    loadScrapeRuns,
    router,
    scrapeMaxDepth,
    scrapeMaxPages,
    scrapeUrl,
    toast,
    workspaceId,
  ]);

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => (
        <WorkspaceBrandLink name={workspace?.name} collapsed={collapsed} />
      )}
      navigation={({ collapsed }) => (
        <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />
      )}
      mobileTabBar={({ moreActive, onMoreClick }) => (
        <MobileTabBar items={workspacePrimaryTabItems(workspaceId)} moreActive={moreActive} onMoreClick={onMoreClick} />
      )}
        title="Documents"
        description="Upload source files, watch ingest status, and remove outdated material."
        badge={
          membership ? (
            <Badge
              variant={membership.role === "member" ? "secondary" : "success"}
            >
              {membership.role}
            </Badge>
          ) : null
        }
        actions={canManage ? <Button type="button" size="sm" onClick={() => setIsScrapeModalOpen(true)}>Scrape website</Button> : null}
        onLogout={handleLogout}
    >
      <div className="space-y-8 px-6 py-10">
        <PageSection
          eyebrow={<Badge variant="outline">Ingestion</Badge>}
          title="Upload documents"
          description="Files land as pending, then move through processing until they are ready for retrieval."
        >
          <Card variant="elevated" className="p-6">
            {canManage ? (
              <div className="space-y-4">
                <label
                  htmlFor="document-upload"
                  data-testid="document-dropzone"
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(event) => void handleDrop(event)}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-[calc(var(--radius)+0.25rem)] border border-dashed px-6 py-12 text-center transition hover:border-primary/40 hover:bg-primary/5 ${
                    dragActive
                      ? "border-primary/60 bg-primary/10"
                      : "border-border/80 bg-secondary/30"
                  }`}
                >
                  <FileUp className="mb-4 size-6 text-primary" />
                  <span className="text-base font-semibold">
                    Drop a file here or click to upload
                  </span>
                  <span className="mt-2 text-sm text-muted-foreground">
                    Small `.txt` and `.pdf` files are good for quick validation.
                  </span>
                </label>
                <input
                  ref={fileInputRef}
                  id="document-upload"
                  aria-label="Upload document"
                  type="file"
                  className="sr-only"
                  onChange={handleFileChange}
                />
              </div>
            ) : (
              <EmptyState
                icon={<FileUp className="size-5" />}
                title="Upload controls hidden"
                description="Only owners and admins can add or remove documents from this knowledge base."
              />
            )}
          </Card>
        </PageSection>

        <PageSection
          eyebrow={<Badge variant="outline">Web sources</Badge>}
          title="Website crawls"
          description="Track crawl runs and page counts. Scraped pages land in document queue automatically."
        >
          <Card variant="elevated" className="space-y-4 p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search crawl runs"
                  placeholder="Search seed URL"
                  className="pl-9"
                  value={scrapeRunSearch}
                  onChange={(event) => setScrapeRunSearch(event.target.value)}
                />
              </div>
              <Select
                aria-label="Filter crawl runs by status"
                className="sm:w-52"
                value={scrapeRunStatusFilter}
                onChange={(event) => setScrapeRunStatusFilter(event.target.value as ScrapeStatusFilter)}
              >
                <option value="">All statuses</option>
                <option value="queued">Queued</option>
                <option value="running">Running</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </Select>
            </div>

            {isScrapeRunsLoading && scrapeRuns.length === 0 ? (
              <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              </div>
          ) : scrapeRuns.length === 0 ? (
            <EmptyState
              icon={<FileUp className="size-5" />}
              title="No crawl runs found"
              description="Start a crawl or adjust search and filters."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Seed URL</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Pages</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scrapeRuns.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="font-medium">{run.seedUrl}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            run.status === "completed"
                              ? "success"
                              : run.status === "failed"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {getScrapeStatusLabel(run)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div>{getScrapeCountLabel(run)}</div>
                          {getScrapeProgressLabel(run) ? (
                            <div className="text-xs text-muted-foreground">
                              {getScrapeProgressLabel(run)}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {run.startedAt
                          ? new Date(run.startedAt).toLocaleString()
                          : "Queued"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={scrapeRunMeta.page}
                pageSize={scrapeRunMeta.pageSize}
                total={scrapeRunMeta.total}
                totalPages={scrapeRunMeta.totalPages}
                onPageChange={setScrapeRunPage}
                onPageSizeChange={setScrapeRunPageSize}
                pageSizeOptions={[5, 10, 20, 50]}
                isLoading={isScrapeRunsLoading}
              />
            </>
          )}
          </Card>
        </PageSection>

        <PageSection
          eyebrow={<Badge variant="secondary">Status</Badge>}
          title="Document queue"
          description="Polling runs every 3 seconds while any document is pending or processing."
        >
          <Card variant="elevated" className="space-y-4 p-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search documents"
                  placeholder="Search document title"
                  className="pl-9"
                  value={documentSearch}
                  onChange={(event) => setDocumentSearch(event.target.value)}
                />
              </div>
              <Select
                aria-label="Filter documents by status"
                className="lg:w-52"
                value={documentStatusFilter}
                onChange={(event) => setDocumentStatusFilter(event.target.value as DocumentStatusFilter)}
              >
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="done">Done</option>
                <option value="failed">Failed</option>
              </Select>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleDownloadSelected()}
                disabled={selectedDocumentIdList.length === 0}
                isLoading={isDownloadingSelected}
                loadingText="Downloading"
              >
                <Download className="size-4" />
                Download selected
              </Button>
              {canManage ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setPendingBulkDelete(true)}
                  disabled={selectedDocumentIdList.length === 0}
                  isLoading={isDeletingSelected}
                  loadingText="Deleting"
                >
                  <Trash2 className="size-4" />
                  Delete selected
                </Button>
              ) : null}
            </div>

            {isLoading && documents.length === 0 ? (
              <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              </div>
          ) : documents.length === 0 ? (
            <EmptyState
              icon={<FileUp className="size-5" />}
              title="No documents yet"
              description="Upload the first document or adjust search and filters."
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 rounded-2xl border border-border/70 bg-card p-5">
                <div className="text-sm font-medium">
                  {inFlightDocumentCount} document
                  {inFlightDocumentCount === 1 ? "" : "s"} in flight
                </div>
                <div className="text-sm text-muted-foreground">
                  {hasInFlightDocuments
                    ? `${documentProgressPercent}% indexed · ${pendingDocumentCount} pending · ${processingDocumentCount} processing · ${failedDocumentCount} failed`
                    : failedDocumentCount > 0
                      ? `${doneDocumentCount} done · ${failedDocumentCount} failed`
                      : `All ${doneDocumentCount} documents indexed.`}
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <input
                        type="checkbox"
                        aria-label="Select all documents"
                        checked={allVisibleDocumentsSelected}
                        onChange={(event) => {
                          setSelectedDocumentIds(
                            event.target.checked
                              ? new Set(documents.map((document) => document.id))
                              : new Set(),
                          );
                        }}
                      />
                    </TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select ${document.title}`}
                          checked={selectedDocumentIds.has(document.id)}
                          onChange={(event) => {
                            setSelectedDocumentIds((current) => {
                              const next = new Set(current);
                              if (event.target.checked) {
                                next.add(document.id);
                              } else {
                                next.delete(document.id);
                              }
                              return next;
                            });
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {document.title}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant[document.status]}>
                          {document.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {document.createdAt
                          ? new Date(document.createdAt).toLocaleString()
                          : "Just now"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Download ${document.title}`}
                          onClick={() => void handleDownloadDocument(document)}
                        >
                          <Download className="size-4" />
                          Download
                        </Button>
                        {canManage ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Delete ${document.title}`}
                            onClick={() => setPendingDelete(document)}
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={documentMeta.page}
                pageSize={documentMeta.pageSize}
                total={documentMeta.total}
                totalPages={documentMeta.totalPages}
                onPageChange={setDocumentPage}
                onPageSizeChange={setDocumentPageSize}
                isLoading={isDocumentsRefreshing}
              />
            </>
          )}
          </Card>
        </PageSection>
      </div>
      <Modal
        open={isScrapeModalOpen}
        onClose={() => setIsScrapeModalOpen(false)}
        title="Scrape website"
      >
        <div className="space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium">Website URL</span>
            <Input
              ref={scrapeUrlInputRef}
              aria-label="Website URL"
              type="url"
              value={scrapeUrl}
              onChange={(event) => setScrapeUrl(event.target.value)}
              placeholder="https://example.com/docs"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium">Max depth</span>
            <Input
              aria-label="Max depth"
              type="number"
              min={0}
              max={5}
              value={scrapeMaxDepth}
              onChange={(event) => setScrapeMaxDepth(event.target.value)}
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium">Max pages</span>
            <Input
              aria-label="Max pages"
              type="number"
              min={1}
              max={2000}
              value={scrapeMaxPages}
              onChange={(event) => setScrapeMaxPages(event.target.value)}
            />
          </label>
          <p className="text-sm text-muted-foreground">
            Article URLs default to that page subtree. Home URLs crawl the
            broader section.
          </p>
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsScrapeModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submitScrape()}
              disabled={!scrapeUrl || isSubmittingScrape}
            >
              Start crawl
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete document"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {pendingDelete
              ? `Delete ${pendingDelete.title}? This removes the source file and its indexed chunks.`
              : ""}
          </p>
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
            >
              Delete document
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={pendingBulkDelete}
        onClose={() => setPendingBulkDelete(false)}
        title="Delete selected documents"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Delete {selectedDocumentIdList.length} selected document
            {selectedDocumentIdList.length === 1 ? "" : "s"}? This removes source files and indexed chunks.
          </p>
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPendingBulkDelete(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmBulkDelete()}
              isLoading={isDeletingSelected}
              loadingText="Deleting"
            >
              Delete selected documents
            </Button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
