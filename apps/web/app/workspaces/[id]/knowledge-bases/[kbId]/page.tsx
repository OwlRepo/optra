"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AppHeader,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageSection,
  PageShell,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@repo/ui";
import { FileUp, Trash2 } from "lucide-react";
import {
  deleteDocument,
  listDocuments,
  uploadDocument,
} from "@/lib/api/documents";
import { listScrapeRuns, scrapeSite } from "@/lib/api/scrape";
import { isUnauthorized } from "@/lib/api/handle-unauthorized";
import { listWorkspaces } from "@/lib/api/workspaces";

type DocumentRow = {
  id: string;
  title: string;
  status: "pending" | "processing" | "done" | "failed";
  createdAt?: string;
  updatedAt?: string;
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

const statusVariant: Record<
  DocumentRow["status"],
  "secondary" | "success" | "destructive"
> = {
  pending: "secondary",
  processing: "secondary",
  done: "success",
  failed: "destructive",
};

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

function sortDocumentsForQueue(left: DocumentRow, right: DocumentRow) {
  const priority: Record<DocumentRow["status"], number> = {
    processing: 0,
    pending: 1,
    failed: 2,
    done: 3,
  };

  const priorityDelta = priority[left.status] - priority[right.status];
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? "") || 0;
  const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? "") || 0;

  return rightTime - leftTime;
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
  const [scrapeRuns, setScrapeRuns] = React.useState<ScrapeRunRow[]>([]);
  const [membership, setMembership] =
    React.useState<WorkspaceMembership | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isScrapeRunsLoading, setIsScrapeRunsLoading] = React.useState(true);
  const [pendingDelete, setPendingDelete] = React.useState<DocumentRow | null>(
    null,
  );
  const [isScrapeModalOpen, setIsScrapeModalOpen] = React.useState(false);
  const [isSubmittingScrape, setIsSubmittingScrape] = React.useState(false);
  const [scrapeUrl, setScrapeUrl] = React.useState("");
  const [scrapeMaxDepth, setScrapeMaxDepth] = React.useState("3");
  const [scrapeMaxPages, setScrapeMaxPages] = React.useState("100");
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const canManage =
    membership?.role === "owner" || membership?.role === "admin";

  React.useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const loadDocuments = React.useCallback(async () => {
    try {
      const data = await listDocuments(workspaceId, knowledgeBaseId);
      setDocuments(Array.isArray(data) ? data : []);
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
    }
  }, [knowledgeBaseId, router, workspaceId]);

  const loadScrapeRuns = React.useCallback(async () => {
    try {
      const data = await listScrapeRuns(workspaceId, knowledgeBaseId);
      setScrapeRuns(Array.isArray(data) ? data : []);
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
  }, [knowledgeBaseId, router, workspaceId]);

  const loadMembership = React.useCallback(async () => {
    try {
      const memberships = await listWorkspaces();
      setMembership(
        (Array.isArray(memberships) ? memberships : []).find(
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
    void Promise.all([loadDocuments(), loadMembership(), loadScrapeRuns()]);
  }, [loadDocuments, loadMembership, loadScrapeRuns]);

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
  const sortedDocuments = [...documents].sort(sortDocumentsForQueue);
  const hasInFlightRuns = scrapeRuns.some(
    (run) => run.status === "queued" || run.status === "running",
  );

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

  const handleFileChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      try {
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
        void loadDocuments();
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
          title: "Upload failed",
          description: message,
        });
      } finally {
        event.target.value = "";
      }
    },
    [knowledgeBaseId, loadDocuments, router, toast, workspaceId],
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
    <PageShell contentClassName="pb-16">
      <AppHeader
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
        navigation={
          <>
            {canManage ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setIsScrapeModalOpen(true)}
              >
                Scrape website
              </Button>
            ) : null}
            <Button asChild variant="ghost" size="sm">
              <Link href={`/workspaces/${workspaceId}`}>Back to workspace</Link>
            </Button>
          </>
        }
      />

      <div className="space-y-8 py-10">
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
                  className="flex cursor-pointer flex-col items-center justify-center rounded-[calc(var(--radius)+0.25rem)] border border-dashed border-border/80 bg-secondary/30 px-6 py-12 text-center transition hover:border-primary/40 hover:bg-primary/5"
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
          {isScrapeRunsLoading ? (
            <Card variant="elevated" className="space-y-4 p-6">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </Card>
          ) : scrapeRuns.length === 0 ? (
            <EmptyState
              icon={<FileUp className="size-5" />}
              title="No web sources yet"
              description="Start a crawl to ingest docs pages from a website."
            />
          ) : (
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
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div>{`${run.pagesFound}/${run.pagesSucceeded}/${run.pagesFailed}`}</div>
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
          )}
        </PageSection>

        <PageSection
          eyebrow={<Badge variant="secondary">Status</Badge>}
          title="Document queue"
          description="Polling runs every 3 seconds while any document is pending or processing."
        >
          {isLoading ? (
            <Card variant="elevated" className="space-y-4 p-6">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </Card>
          ) : documents.length === 0 ? (
            <EmptyState
              icon={<FileUp className="size-5" />}
              title="No documents yet"
              description="Upload the first document to start the ingest pipeline."
            />
          ) : (
            <Table>
              <TableHeader>
                <div className="flex items-center justify-between gap-2 p-5">
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
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDocuments.map((document) => (
                  <TableRow key={document.id}>
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
          )}
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
    </PageShell>
  );
}
