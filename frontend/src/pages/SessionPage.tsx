import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Clock, Cpu, Monitor, FileText, Inbox, ListChecks, Sparkles } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";
import { Skeleton } from "../components/ui/skeleton";
import { Card, CardContent } from "../components/ui/card";
import { cn } from "../lib/utils";
import { api } from "../lib/tauri";
import type { SessionInfo } from "../lib/types";

function cleanSummary(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip claude- prefix and -YYYYMMDD suffix from model name */
function formatModel(model: string | null): string {
  if (!model) return "\u2014";
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

/** Truncate machine name at first dot */
function formatMachine(machine: string): string {
  return machine.split(".")[0];
}

/* ── Loading skeleton ── */

function SessionSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-8 py-6">
      <Skeleton className="h-7 w-3/4 mb-4" />
      <div className="flex items-center gap-3 mb-6">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-16" />
      </div>
      <Skeleton className="h-px w-full mb-6" />
      <Skeleton className="h-4 w-20 mb-3" />
      <Skeleton className="h-24 w-full rounded-lg mb-6" />
      <Skeleton className="h-4 w-20 mb-3" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  );
}

/* ── Main component ── */

export function SessionPage() {
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const { t } = useTranslation();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !sessionId) return;
    setLoading(true);
    api
      .getSessions(id)
      .then((sessions) => {
        const match = sessions.find((s) => s.id === sessionId);
        setSession(match ?? null);
      })
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, [id, sessionId]);

  if (loading) {
    return <SessionSkeleton />;
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <Inbox size={32} className="text-[hsl(var(--muted-foreground))]" />
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Session not found.
        </p>
        <Link
          to={`/project/${id}`}
          className="text-sm hover:underline text-[hsl(var(--primary))]"
        >
          {t("project.backToDashboard")}
        </Link>
      </div>
    );
  }

  const summary = session.summary ? cleanSummary(session.summary) : "";
  const nextSteps = session.next_steps ? cleanSummary(session.next_steps) : "";
  const title = summary ? summary.split(/[.!?]/)[0].trim() || summary : "Session";
  const cost = session.estimated_cost_usd;

  return (
    <div className="max-w-3xl mx-auto px-8 py-6">
      {/* Title: first sentence of summary */}
      <h1 className="text-xl font-semibold text-[hsl(var(--foreground))] mb-3 leading-snug">
        {title}
      </h1>

      {/* Properties row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Machine */}
        <div className="flex items-center gap-1.5">
          <Monitor size={12} className="text-[hsl(var(--muted-foreground))]" />
          <Badge variant="outline" className="text-[11px] px-1.5 py-0 font-mono">
            {formatMachine(session.machine)}
          </Badge>
        </div>

        {/* Duration */}
        {session.duration_minutes != null && (
          <div className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
            <Clock size={12} />
            <span className="font-mono tabular-nums">{session.duration_minutes}m</span>
          </div>
        )}

        {/* Cost */}
        {cost != null && cost > 0 && (
          <Badge
            variant={cost >= 1 ? "warning" : "success"}
            className="text-[11px] px-1.5 py-0 font-mono"
          >
            ${cost.toFixed(4)}
          </Badge>
        )}

        {/* Model */}
        {session.model && (
          <div className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
            <Cpu size={12} />
            <span className="font-mono">{formatModel(session.model)}</span>
          </div>
        )}

        {/* Files changed */}
        {session.files_changed > 0 && (
          <div className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
            <FileText size={12} />
            <span className="font-mono tabular-nums">{session.files_changed} files</span>
          </div>
        )}
      </div>

      <Separator className="mb-6" />

      {/* Summary section */}
      {summary && (
        <section className="mb-6">
          <h2 className="font-semibold uppercase tracking-wider text-[11px] text-[hsl(var(--muted-foreground))] mb-3">
            Summary
          </h2>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm leading-relaxed text-[hsl(var(--foreground))]">
                {summary}
              </p>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Next Steps section */}
      {nextSteps && (
        <section className="mb-6">
          <h2 className="font-semibold uppercase tracking-wider text-[11px] text-[hsl(var(--muted-foreground))] mb-3 flex items-center gap-1.5">
            <ListChecks size={12} />
            {t("project.nextSteps")}
          </h2>
          <Card
            className="border-[hsl(var(--primary))]/20"
            style={{ background: "hsl(var(--accent) / 0.05)" }}
          >
            <CardContent className="p-4">
              <p className="text-sm leading-relaxed text-[hsl(var(--foreground))]">
                {nextSteps}
              </p>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Highlights section */}
      {session.transcript_highlights.length > 0 && (
        <section className="mb-6">
          <h2 className="font-semibold uppercase tracking-wider text-[11px] text-[hsl(var(--muted-foreground))] mb-3 flex items-center gap-1.5">
            <Sparkles size={12} />
            Highlights
          </h2>
          <Card>
            <CardContent className="p-4">
              <ul className="space-y-2">
                {session.transcript_highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0",
                        "bg-[hsl(var(--primary))]"
                      )}
                    />
                    <span className="text-sm leading-relaxed text-[hsl(var(--foreground))]">
                      {h}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
