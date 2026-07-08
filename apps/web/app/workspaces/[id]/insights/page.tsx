"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  StatCard,
  StatusBanner,
  cn,
  useToast,
} from "@repo/ui";
import { BarChart3, Check, LineChart, MessageCircleQuestion, X } from "lucide-react";
import { logout } from "@/lib/api/auth";
import {
  approveFaqDraft,
  dismissFreshnessFlag,
  getCoverage,
  listFaqDrafts,
  listFreshnessFlags,
  rejectFaqDraft,
} from "@/lib/api/insights";
import { isUnauthorized } from "@/lib/api/handle-unauthorized";
import { getWorkspace } from "@/lib/api/workspaces";
import { WorkspaceNav, workspacePrimaryTabItems } from "@/components/workspace-nav";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { WorkspaceBrandLink } from "@/components/workspace-brand-link";

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

type CoverageSummary = {
  totalQueries: number;
  fallbackRate: number;
  cacheHitRate: number;
  avgTopScore: number | null;
};

type LowScoreQuery = {
  id: string;
  question: string;
  topScore: number | null;
  isFallback: boolean;
  createdAt: string;
};

type TopicGap = {
  label: string;
  questionCount: number;
  exampleQuestion: string;
};

type Coverage = {
  summary: CoverageSummary;
  lowScoreQueries: LowScoreQuery[];
  topicGaps: TopicGap[];
};

type Tab = "freshness" | "faq" | "coverage";

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
  const [coverage, setCoverage] = React.useState<Coverage | null>(null);
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

  const loadCoverage = React.useCallback(async () => {
    try {
      const data = await getCoverage(workspaceId);
      setCoverage(data ?? null);
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
    else if (tab === "faq") void loadDrafts();
    else void loadCoverage();
  }, [tab, loadFlags, loadDrafts, loadCoverage]);

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
        <WorkspaceBrandLink name={workspace?.name} collapsed={collapsed} />
      )}
      navigation={({ collapsed }) => <WorkspaceNav workspaceId={workspaceId} collapsed={collapsed} />}
      mobileTabBar={({ moreActive, onMoreClick }) => (
        <MobileTabBar items={workspacePrimaryTabItems(workspaceId)} moreActive={moreActive} onMoreClick={onMoreClick} />
      )}
      title="Insights"
      description="Weekly checks over your tickets and chat traffic: stale documents, drafted FAQs, and answer coverage."
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
          <Button
            type="button"
            size="sm"
            variant={tab === "coverage" ? "default" : "ghost"}
            onClick={() => setTab("coverage")}
          >
            Coverage
          </Button>
        </div>

        {loadError ? (
          <div className="mb-4">
            <StatusBanner variant="error" title="Failed to load insights" description={loadError} />
          </div>
        ) : null}

        {tab === "freshness" ? (
          <Card variant="elevated" className="overflow-hidden">
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
          </Card>
        ) : null}

        {tab === "faq" ? (
          <Card variant="elevated" className="overflow-hidden">
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
          </Card>
        ) : null}

        {tab === "coverage" ? (
          <div className="space-y-6">
            {coverage ? (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <StatCard
                    label="Fallback rate"
                    value={`${Math.round(coverage.summary.fallbackRate * 100)}%`}
                    hint="Last 30 days"
                  />
                  <StatCard
                    label="Cache hit rate"
                    value={`${Math.round(coverage.summary.cacheHitRate * 100)}%`}
                    hint="Last 30 days"
                  />
                  <StatCard
                    label="Avg. top match score"
                    value={coverage.summary.avgTopScore !== null ? coverage.summary.avgTopScore.toFixed(2) : "—"}
                    hint={`${coverage.summary.totalQueries} queries`}
                  />
                </div>

                <Card variant="elevated" className="overflow-hidden">
                  <div className="border-b border-border/70 px-6 py-4">
                    <p className="font-medium">Low-confidence questions</p>
                  </div>
                  {coverage.lowScoreQueries.length === 0 ? (
                    <div className="p-6">
                      <EmptyState
                        icon={<BarChart3 className="size-5" />}
                        title="No low-confidence questions"
                        description="Nothing here yet — this fills in as chat traffic accumulates."
                      />
                    </div>
                  ) : (
                    <div className="divide-y divide-border/70">
                      {coverage.lowScoreQueries.map((query) => (
                        <div key={query.id} className="flex items-center justify-between gap-4 px-6 py-4">
                          <p className="min-w-0 truncate">{query.question}</p>
                          <Badge variant={query.isFallback ? "destructive" : "secondary"}>
                            {query.isFallback ? "no answer" : query.topScore?.toFixed(2)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card variant="elevated" className="overflow-hidden">
                  <div className="border-b border-border/70 px-6 py-4">
                    <p className="font-medium">Topic gaps</p>
                  </div>
                  {coverage.topicGaps.length === 0 ? (
                    <div className="p-6">
                      <EmptyState
                        icon={<BarChart3 className="size-5" />}
                        title="No topic gaps yet"
                        description="The weekly check clusters repeated low-confidence questions — nothing computed yet."
                      />
                    </div>
                  ) : (
                    <div className="divide-y divide-border/70">
                      {coverage.topicGaps.map((gap) => (
                        <div key={gap.label} className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{gap.label}</p>
                            <Badge variant="secondary">{gap.questionCount} questions</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">e.g. “{gap.exampleQuestion}”</p>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
