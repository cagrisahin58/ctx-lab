import { useState } from "react";
import { format } from "date-fns";
import { ChevronRight } from "lucide-react";
import type { SessionInfo } from "../lib/types";

function cleanSummary(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function SessionRow({
  session,
  isOpen,
  onToggle,
}: {
  session: SessionInfo;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const summary = session.summary ? cleanSummary(session.summary) : "\u2014";
  const nextSteps = session.next_steps ? cleanSummary(session.next_steps) : "";

  return (
    <div style={{ borderBottom: "1px solid hsl(var(--border))" }}>
      {/* Clickable row */}
      <button
        onClick={onToggle}
        className="w-full text-left flex items-center gap-3 px-3 py-2.5 transition-colors duration-100 hover:bg-[hsl(var(--muted))]/50"
        style={{ background: isOpen ? "hsl(var(--muted))" : "transparent" }}
      >
        {/* Chevron */}
        <ChevronRight
          size={14}
          className="flex-shrink-0 transition-transform duration-200"
          style={{
            color: "hsl(var(--muted-foreground))",
            transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
          }}
        />

        {/* Date */}
        <span
          className="font-mono tabular-nums flex-shrink-0"
          style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", width: 100 }}
        >
          {format(new Date(session.started_at), "MMM d, HH:mm")}
          {session.duration_minutes != null && (
            <span style={{ color: "hsl(var(--muted-foreground))", marginLeft: 4 }}>
              {session.duration_minutes}m
            </span>
          )}
        </span>

        {/* Summary (truncated) */}
        <span
          className="flex-1 truncate"
          style={{ fontSize: 13, color: "hsl(var(--foreground))" }}
        >
          {summary}
        </span>

        {/* Machine */}
        <span
          className="font-mono flex-shrink-0"
          style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}
        >
          {session.machine.split(".")[0]}
          {session.recovered && (
            <span style={{ color: "hsl(var(--warning))", marginLeft: 4 }}>{"\u25cf"}</span>
          )}
        </span>
      </button>

      {/* Accordion expanded content */}
      <div className={`accordion-content ${isOpen ? "open" : ""}`}>
        <div className="accordion-inner">
          <div className="px-3 pb-3 pt-1" style={{ paddingLeft: 38 }}>
            {/* Full summary */}
            <p style={{ fontSize: 13, color: "hsl(var(--foreground))", lineHeight: "1.6" }}>
              {summary}
            </p>

            {/* Next steps */}
            {nextSteps && (
              <div className="mt-2">
                <span
                  className="font-semibold uppercase tracking-wider"
                  style={{ fontSize: 10, color: "hsl(var(--primary))" }}
                >
                  Next Steps
                </span>
                <p
                  className="mt-0.5"
                  style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", lineHeight: "1.5" }}
                >
                  {nextSteps}
                </p>
              </div>
            )}

            {/* Meta row */}
            <div className="flex items-center gap-4 mt-2">
              {session.files_changed > 0 && (
                <span className="font-mono" style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                  {session.files_changed} files changed
                </span>
              )}
              {session.transcript_highlights.length > 0 && (
                <span className="font-mono" style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                  {session.transcript_highlights.length} highlights
                </span>
              )}
              {session.estimated_cost_usd != null && session.estimated_cost_usd > 0 && (
                <span
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    color: session.estimated_cost_usd > 1 ? "hsl(var(--warning))" : "hsl(var(--success))",
                  }}
                >
                  ${session.estimated_cost_usd.toFixed(4)}
                </span>
              )}
              {session.model && (
                <span className="font-mono" style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                  {session.model.replace(/^claude-/, "").replace(/-\d{8}$/, "")}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SessionList({ sessions }: { sessions: SessionInfo[] }) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  if (sessions.length === 0) {
    return (
      <p className="py-6 text-center text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
        No sessions recorded yet.
      </p>
    );
  }

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
    >
      {/* Table header */}
      <div
        className="flex items-center gap-3 px-3 py-2"
        style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--background))" }}
      >
        <span style={{ width: 14 }} />
        <span
          className="font-semibold uppercase tracking-wider"
          style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", width: 100 }}
        >
          Date
        </span>
        <span
          className="font-semibold uppercase tracking-wider flex-1"
          style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}
        >
          Summary
        </span>
        <span
          className="font-semibold uppercase tracking-wider"
          style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}
        >
          Machine
        </span>
      </div>

      {/* Rows */}
      {sessions.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          isOpen={openIds.has(s.id)}
          onToggle={() => toggle(s.id)}
        />
      ))}
    </div>
  );
}
