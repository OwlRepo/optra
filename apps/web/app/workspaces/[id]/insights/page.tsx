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
import { LineChart, X } from "lucide-react";
import { logout } from "@/lib/api/auth";
import { dismissFreshnessFlag, listFreshnessFlags } from "@/lib/api/insights";
import { isUnauthorized } from "@/lib/api/handle-unauthorized";
import { getWorkspace } from "@/lib/api/workspaces";
import { WorkspaceNav } from "@/components/workspace-nav";

type FreshnessFlag = {
  id: string;
  documentId: string;
  documentTitle: string;
  ticketId: string | null;
  score: number | null;
  reason: string;
  createdAt: string;
};

export default function WorkspaceInsightsPage({
  params,
}: {
  params: { id: string };
}) {
  const workspaceId = params.id;
  const router = useRouter();
  const { toast } = useToast();
  const toastRef = React.useRef(toast);
  const [workspace, setWorkspace] = React.useState<{ id: string; name: string } | null>(null);
  const [flags, setFlags] = React.useState<FreshnessFlag[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const extractErrorMessage = (err: unknown, fallback: string) =>
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : fallback;

  const loadFlags = React.useCallback(async () => {
    try {
      const data = await listFreshnessFlags(workspaceId);
      setFlags(Array.isArray(data) ? data : []);
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
    void loadFlags();
  }, [loadFlags]);

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

  const handleDismiss = async (flag: FreshnessFlag) => {
    try {
      await dismissFreshnessFlag(workspaceId, flag.id);
      setFlags((current) => current.filter((row) => row.id !== flag.id));
      toastRef.current({
        variant: "success",
        title: "Flag dismissed",
        description: flag.documentTitle,
      });
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
        return;
      }
      toastRef.current({
        variant: "error",
        title: "Failed to dismiss flag",
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
      title="Insights"
      description="Documents where recent tickets don't match well — a weekly check for content that may be stale or missing."
      onLogout={handleLogout}
    >
      <div className="px-6 py-6">
        <Card variant="elevated" className="overflow-hidden">
          {loadError ? (
            <div className="p-6">
              <StatusBanner variant="error" title="Failed to load insights" description={loadError} />
            </div>
          ) : null}

          {!isLoading && flags.length === 0 && !loadError ? (
            <div className="p-6">
              <EmptyState
                icon={<LineChart className="size-5" />}
                title="No freshness flags"
                description="Nothing to review yet — the weekly check compares recent tickets against your documents."
              />
            </div>
          ) : null}

          {flags.length > 0 ? (
            <div className="divide-y divide-border/70">
              {flags.map((flag) => (
                <div
                  key={flag.id}
                  className="flex items-center justify-between gap-4 px-6 py-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{flag.documentTitle}</p>
                      <Badge variant="secondary">{flag.reason}</Badge>
                    </div>
                    {flag.score !== null ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Match score {flag.score.toFixed(2)} against a recent ticket
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDismiss(flag)}
                    aria-label={`Dismiss flag for ${flag.documentTitle}`}
                  >
                    <X className="size-4" />
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
