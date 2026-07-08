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
  cn,
  useToast,
} from "@repo/ui";
import { Check, LineChart, MessageCircleQuestion, X } from "lucide-react";
import { logout } from "@/lib/api/auth";
import {
  approveFaqDraft,
  dismissFreshnessFlag,
  listFaqDrafts,
  listFreshnessFlags,
  rejectFaqDraft,
} from "@/lib/api/insights";
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

type FaqDraft = {
  id: string;
  question: string;
  answer: string;
  clusterSize: number;
  createdAt: string;
};

type Tab = "freshness" | "faq";

export default function WorkspaceInsightsPage({
  params,
}: {
  params: { id: string };
}) {
  const workspaceId = params.id;
  const router = useRouter();
  const { toast } = useToast();
  const toastRef = React.useRef(toast);
  const [tab, setTab] = React.useState<Tab>("freshness");
  const [workspace, setWorkspace] = React.useState<{ id: string; name: string } | null>(null);
  const [flags, setFlags] = React.useState<FreshnessFlag[]>([]);
  const [drafts, setDrafts] = React.useState<FaqDraft[]>([]);
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

  const loadDrafts = React.useCallback(async () => {
    try {
      const data = await listFaqDrafts(workspaceId);
      setDrafts(Array.isArray(data) ? data : []);
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
    setIsLoading(true);
    if (tab === "freshness") void loadFlags();
    else void loadDrafts();
  }, [tab, loadFlags, loadDrafts]);

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
      toastRef.current({ variant: "success", title: "Flag dismissed", description: flag.documentTitle });
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

  const handleApprove = async (draft: FaqDraft) => {
    try {
      await approveFaqDraft(workspaceId, draft.id);
      setDrafts((current) => current.filter((row) => row.id !== draft.id));
      toastRef.current({ variant: "success", title: "FAQ approved", description: draft.question });
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
        return;
      }
      toastRef.current({
        variant: "error",
        title: "Failed to approve draft",
        description: extractErrorMessage(err, "Try again in a moment."),
      });
    }
  };

  const handleReject = async (draft: FaqDraft) => {
    try {
      await rejectFaqDraft(workspaceId, draft.id);
      setDrafts((current) => current.filter((row) => row.id !== draft.id));
      toastRef.current({ variant: "success", title: "FAQ rejected", description: draft.question });
    } catch (err) {
      if (isUnauthorized(err)) {
        router.push("/login");
        return;
      }
      toastRef.current({
        variant: "error",
        title: "Failed to reject draft",
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
      description="Weekly checks over your tickets: documents that may be stale, and FAQs drafted from repeated questions."
      onLogout={handleLogout}
    >
      <div className="px-6 py-6">
        <div className="mb-4 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={tab === "freshness" ? "default" : "ghost"}
            onClick={() => setTab("freshness")}
          >
            Freshness
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tab === "faq" ? "default" : "ghost"}
            onClick={() => setTab("faq")}
          >
            FAQ drafts
          </Button>
        </div>

        <Card variant="elevated" className="overflow-hidden">
          {loadError ? (
            <div className="p-6">
              <StatusBanner variant="error" title="Failed to load insights" description={loadError} />
            </div>
          ) : null}

          {tab === "freshness" ? (
            <>
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
                    <div key={flag.id} className="flex items-center justify-between gap-4 px-6 py-4">
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
            </>
          ) : (
            <>
              {!isLoading && drafts.length === 0 && !loadError ? (
                <div className="p-6">
                  <EmptyState
                    icon={<MessageCircleQuestion className="size-5" />}
                    title="No FAQ drafts"
                    description="Nothing to review yet — drafts appear weekly when several tickets ask the same undocumented question."
                  />
                </div>
              ) : null}

              {drafts.length > 0 ? (
                <div className="divide-y divide-border/70">
                  {drafts.map((draft) => (
                    <div key={draft.id} className="flex items-start justify-between gap-4 px-6 py-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium">{draft.question}</p>
                          <Badge variant="secondary">{draft.clusterSize} tickets</Badge>
                        </div>
                        <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{draft.answer}</p>
                      </div>
                      <div className={cn("flex shrink-0 gap-1")}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleApprove(draft)}
                          aria-label={`Approve FAQ: ${draft.question}`}
                        >
                          <Check className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleReject(draft)}
                          aria-label={`Reject FAQ: ${draft.question}`}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
