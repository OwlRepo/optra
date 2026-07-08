"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  StatusBanner,
  useToast,
} from "@repo/ui";
import { Database, Trash2, Upload } from "lucide-react";
import { logout } from "@/lib/api/auth";
import { deleteDataset, listDatasets, uploadDataset } from "@/lib/api/datasets";
import { isUnauthorized } from "@/lib/api/handle-unauthorized";
import { getWorkspace } from "@/lib/api/workspaces";
import { WorkspaceNav } from "@/components/workspace-nav";

type DatasetStatus = "pending" | "processing" | "done" | "failed";

type Dataset = {
  id: string;
  name: string;
  status: DatasetStatus;
  rowCount: number | null;
  description: string | null;
  lastError: string | null;
  createdAt: string;
};

const statusVariant: Record<DatasetStatus, "secondary" | "success" | "destructive"> = {
  pending: "secondary",
  processing: "secondary",
  done: "success",
  failed: "destructive",
};

const statusLabel: Record<DatasetStatus, string> = {
  pending: "Queued",
  processing: "Profiling",
  done: "Ready",
  failed: "Failed",
};

export default function WorkspaceDatasetsPage({
  params,
}: {
  params: { id: string };
}) {
  const workspaceId = params.id;
  const router = useRouter();
  const { toast } = useToast();
  const toastRef = React.useRef(toast);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [workspace, setWorkspace] = React.useState<{ id: string; name: string } | null>(null);
  const [datasets, setDatasets] = React.useState<Dataset[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isUploading, setIsUploading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const extractErrorMessage = (err: unknown, fallback: string) =>
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : fallback;

  const loadDatasets = React.useCallback(async () => {
    try {
      const data = await listDatasets(workspaceId);
      setDatasets(Array.isArray(data) ? data : []);
      setLoadError(null);
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
        return;
      }
      setLoadError(extractErrorMessage(err, "Try again in a moment."));
    } finally {
      setIsLoading(false);
    }
  }, [router, workspaceId]);

  React.useEffect(() => {
    void loadDatasets();
  }, [loadDatasets]);

  // Datasets typically finish profiling within seconds; poll while any row is
  // still pending/processing so status/rowCount update without a manual reload.
  React.useEffect(() => {
    const hasInFlight = datasets.some(
      (dataset) => dataset.status === "pending" || dataset.status === "processing",
    );
    if (!hasInFlight) return;

    const interval = window.setInterval(() => void loadDatasets(), 3000);
    return () => window.clearInterval(interval);
  }, [datasets, loadDatasets]);

  React.useEffect(() => {
    void getWorkspace(workspaceId)
      .then((data) => setWorkspace(data))
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

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    try {
      await uploadDataset(workspaceId, file);
      toastRef.current({
        variant: "success",
        title: "Dataset uploaded",
        description: `${file.name} is being profiled.`,
      });
      await loadDatasets();
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
        return;
      }
      toastRef.current({
        variant: "error",
        title: "Upload failed",
        description: extractErrorMessage(err, "Try again in a moment."),
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (dataset: Dataset) => {
    try {
      await deleteDataset(workspaceId, dataset.id);
      setDatasets((current) => current.filter((row) => row.id !== dataset.id));
      toastRef.current({
        variant: "success",
        title: "Dataset deleted",
        description: dataset.name,
      });
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
        return;
      }
      toastRef.current({
        variant: "error",
        title: "Failed to delete dataset",
        description: extractErrorMessage(err, "Try again in a moment."),
      });
    }
  };

  return (
    <AppShell
      sidebarHeader={({ collapsed }) => (
        <Link href="/workspaces" className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            {workspace?.name?.[0]?.toUpperCase() ?? "W"}
          </span>
          {!collapsed ? <span className="truncate">{workspace?.name ?? "Workspace"}</span> : null}
        </Link>
      )}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
      title="Datasets"
      description="Upload CSV or XLSX files to ask structured questions about them in chat."
      actions={
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            onChange={(event) => void handleFileSelected(event)}
          />
          <Button size="sm" onClick={handleUploadClick} isLoading={isUploading} loadingText="Uploading">
            {!isUploading ? <Upload className="size-4" /> : null}
            {!isUploading ? "Upload dataset" : null}
          </Button>
        </>
      }
      onLogout={handleLogout}
    >
      <div className="px-6 py-6">
        <Card variant="elevated" className="overflow-hidden">
          {loadError ? (
            <div className="p-6">
              <StatusBanner variant="error" title="Failed to load datasets" description={loadError} />
            </div>
          ) : null}

          {!isLoading && datasets.length === 0 && !loadError ? (
            <div className="p-6">
              <EmptyState
                icon={<Database className="size-5" />}
                title="No datasets yet"
                description="Upload a CSV or XLSX file to ask questions like “total revenue by product” in chat."
                actions={
                  <Button size="sm" onClick={handleUploadClick}>
                    <Upload className="size-4" />
                    Upload dataset
                  </Button>
                }
              />
            </div>
          ) : null}

          {datasets.length > 0 ? (
            <div className="divide-y divide-border/70">
              {datasets.map((dataset) => (
                <div
                  key={dataset.id}
                  className="flex items-center justify-between gap-4 px-6 py-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{dataset.name}</p>
                      <Badge variant={statusVariant[dataset.status]}>
                        {statusLabel[dataset.status]}
                      </Badge>
                    </div>
                    {dataset.status === "done" && dataset.description ? (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {dataset.description}
                      </p>
                    ) : null}
                    {dataset.status === "failed" && dataset.lastError ? (
                      <p className="mt-1 line-clamp-2 text-xs text-destructive">
                        {dataset.lastError}
                      </p>
                    ) : null}
                    {dataset.status === "done" && dataset.rowCount !== null ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {dataset.rowCount} rows
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDelete(dataset)}
                    aria-label={`Delete ${dataset.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
    </AppShell>
  );
}
