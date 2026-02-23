import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Clock, Hash, DollarSign, Inbox } from "lucide-react";
import { format } from "date-fns";
import { api } from "../lib/tauri";
import { cn } from "../lib/utils";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";
import { Skeleton } from "../components/ui/skeleton";
import { Progress } from "../components/ui/progress";
import { RoadmapView } from "../components/RoadmapView";
import type { ProjectDetail, SessionInfo } from "../lib/types";

function cleanSummary(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── Session list (simple clickable rows) ── */

function SessionRow({
  session,
  projectId,
  navigate,
}: {
  session: SessionInfo;
  projectId: string;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const summary = session.summary ? cleanSummary(session.summary) : "\u2014";

  return (
    <button
      onClick={() => navigate(`/project/${projectId}/session/${session.id}`)}
      className="w-full text-left flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[hsl(var(--muted))]/50"
      style={{ borderBottom: "1px solid hsl(var(--border))" }}
    >
      {/* Date */}
      <span className="font-mono tabular-nums text-xs text-[hsl(var(--muted-foreground))] flex-shrink-0 w-[100px]">
        {format(new Date(session.started_at), "MMM d, HH:mm")}
      </span>

      {/* Summary */}
      <span className="flex-1 truncate text-sm text-[hsl(var(--foreground))]">
        {summary}
      </span>

      {/* Duration */}
      {session.duration_minutes != null && (
        <span className="font-mono tabular-nums text-[11px] text-[hsl(var(--muted-foreground))] flex-shrink-0">
          {session.duration_minutes}m
        </span>
      )}

      {/* Cost */}
      {session.estimated_cost_usd != null && session.estimated_cost_usd > 0 && (
        <Badge
          variant={session.estimated_cost_usd >= 1 ? "warning" : "success"}
          className="text-[10px] px-1.5 py-0 flex-shrink-0"
        >
          ${session.estimated_cost_usd.toFixed(4)}
        </Badge>
      )}

      {/* Machine */}
      <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))] flex-shrink-0">
        {session.machine.split(".")[0]}
      </span>
    </button>
  );
}

function SessionsList({
  sessions,
  projectId,
  navigate,
}: {
  sessions: SessionInfo[];
  projectId: string;
  navigate: ReturnType<typeof useNavigate>;
}) {
  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-2">
        <Inbox size={24} className="text-[hsl(var(--muted-foreground))]" />
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          No sessions recorded yet.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] overflow-hidden bg-[hsl(var(--card))]">
      {sessions.map((s) => (
        <SessionRow key={s.id} session={s} projectId={projectId} navigate={navigate} />
      ))}
    </div>
  );
}

/* ── Loading skeleton ── */

function ProjectSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-8 py-6">
      <Skeleton className="h-8 w-64 mb-4" />
      <div className="flex items-center gap-3 mb-6">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-16" />
      </div>
      <Skeleton className="h-px w-full mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-2">
          <Skeleton className="h-4 w-20 mb-3" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
        <div className="lg:col-span-2 space-y-2">
          <Skeleton className="h-4 w-20 mb-3" />
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full rounded" />)}
        </div>
      </div>
    </div>
  );
}

/* ── Main component ── */

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .getProjectDetail(id)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <ProjectSkeleton />;
  }

  if (!detail) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <Inbox size={32} className="text-[hsl(var(--muted-foreground))]" />
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {t("common.notFound")}
        </p>
      </div>
    );
  }

  const nextSteps =
    detail.recent_sessions.length > 0 && detail.recent_sessions[0].next_steps
      ? cleanSummary(detail.recent_sessions[0].next_steps)
      : null;

  return (
    <div className="max-w-5xl mx-auto px-8 py-6">
      {/* Large title */}
      <h1 className="text-2xl font-semibold text-[hsl(var(--foreground))] mb-3">
        {detail.name}
      </h1>

      {/* Properties row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Status badge */}
        <Badge variant={detail.status === "active" ? "default" : "secondary"}>
          {detail.status}
        </Badge>

        {/* Progress */}
        {detail.progress_percent > 0 && (
          <div className="flex items-center gap-2">
            <Progress value={detail.progress_percent} className="h-1.5 w-20" />
            <span className="font-mono tabular-nums text-[11px] text-[hsl(var(--muted-foreground))]">
              {Math.round(detail.progress_percent)}%
            </span>
          </div>
        )}

        {/* Sessions count */}
        {detail.session_count > 0 && (
          <div className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
            <Hash size={12} />
            <span className="font-mono tabular-nums">{detail.session_count} {t("project.sessions").toLowerCase()}</span>
          </div>
        )}

        {/* Time */}
        {detail.total_minutes > 0 && (
          <div className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
            <Clock size={12} />
            <span className="font-mono tabular-nums">{detail.total_minutes}m</span>
          </div>
        )}

        {/* Cost (from OverviewRow if available in detail — compute from sessions) */}
        {detail.recent_sessions.length > 0 && (() => {
          const totalCost = detail.recent_sessions.reduce(
            (sum, s) => sum + (s.estimated_cost_usd ?? 0), 0
          );
          if (totalCost <= 0) return null;
          return (
            <div className="flex items-center gap-1 text-xs">
              <DollarSign size={12} className="text-[hsl(var(--muted-foreground))]" />
              <span
                className={cn(
                  "font-mono tabular-nums",
                  totalCost >= 1
                    ? "text-[hsl(var(--warning))]"
                    : "text-[hsl(var(--success))]"
                )}
              >
                ${totalCost.toFixed(2)}
              </span>
            </div>
          );
        })()}
      </div>

      <Separator className="mb-6" />

      {/* Next Steps banner */}
      {nextSteps && (
        <div
          className="mb-6 flex items-start gap-3 rounded-lg px-4 py-3 border"
          style={{
            background: "hsl(var(--accent) / 0.1)",
            borderColor: "hsl(var(--accent) / 0.2)",
          }}
        >
          <ArrowRight size={14} className="mt-0.5 flex-shrink-0 text-[hsl(var(--primary))]" />
          <div>
            <span className="font-semibold uppercase tracking-wider text-[10px] text-[hsl(var(--primary))]">
              {t("project.nextSteps")}
            </span>
            <p className="text-sm leading-relaxed text-[hsl(var(--foreground))] mt-0.5">
              {nextSteps}
            </p>
          </div>
        </div>
      )}

      {/* Two columns: Roadmap + Sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <h2 className="font-semibold uppercase tracking-wider text-[11px] text-[hsl(var(--muted-foreground))] mb-3">
            {t("project.roadmap")}
          </h2>
          <RoadmapView roadmap={detail.roadmap} />
        </div>
        <div className="lg:col-span-2">
          <h2 className="font-semibold uppercase tracking-wider text-[11px] text-[hsl(var(--muted-foreground))] mb-3">
            {t("project.sessions")}
          </h2>
          <SessionsList
            sessions={detail.recent_sessions}
            projectId={id!}
            navigate={navigate}
          />
        </div>
      </div>
    </div>
  );
}
