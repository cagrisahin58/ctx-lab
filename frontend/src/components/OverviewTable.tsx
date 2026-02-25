import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { api } from "../lib/tauri";
import { ProgressBar } from "./ProgressBar";
import type { OverviewRow } from "../lib/types";

type SortField = "name" | "last_session_at" | "progress_percent" | "session_count" | "total_minutes" | "total_cost";
type SortDir = "asc" | "desc";

export function OverviewTable({
  onSelectProject,
}: {
  onSelectProject: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sortField, setSortField] = useState<SortField>("last_session_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    setLoading(true);
    api.getOverview(includeArchived).then(setRows).finally(() => setLoading(false));
  }, [includeArchived]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortField) {
      case "name":
        return dir * a.name.localeCompare(b.name);
      case "last_session_at":
        return dir * ((a.last_session_at ?? "").localeCompare(b.last_session_at ?? ""));
      case "progress_percent":
        return dir * (a.progress_percent - b.progress_percent);
      case "session_count":
        return dir * (a.session_count - b.session_count);
      case "total_minutes":
        return dir * (a.total_minutes - b.total_minutes);
      case "total_cost":
        return dir * (a.total_cost - b.total_cost);
      default:
        return 0;
    }
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <p style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Show archived toggle */}
      <div className="flex items-center justify-end mb-4">
        <label className="flex items-center gap-2.5 cursor-pointer group">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="rounded"
            style={{ accentColor: "var(--accent)" }}
          />
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("overview.showArchived")}
          </span>
        </label>
      </div>

      <div
        className="rounded-xl overflow-hidden glass-card"
        style={{ border: "1px solid var(--border-subtle)", background: "var(--bg-surface)" }}
      >
        {/* Header row */}
        <div
          className="grid gap-2 px-4 py-3"
          style={{
            gridTemplateColumns: "2fr 1fr 1fr 80px 80px 80px",
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--bg-surface-elevated)",
          }}
        >
          {(
            [
              ["name", t("overview.project")],
              ["last_session_at", t("overview.lastActivity")],
              ["progress_percent", t("overview.progress")],
              ["session_count", t("overview.sessions")],
              ["total_minutes", t("overview.time")],
              ["total_cost", t("overview.cost")],
            ] as [SortField, string][]
          ).map(([field, label]) => (
            <button
              key={field}
              onClick={() => toggleSort(field)}
              className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-left transition-colors duration-150 rounded-md px-1 py-0.5"
              style={{
                fontSize: 10,
                color: sortField === field ? "var(--accent)" : "var(--text-muted)",
                background: sortField === field ? "var(--accent-subtle)" : "transparent",
              }}
            >
              {label}
              <ArrowUpDown
                size={10}
                style={{
                  opacity: sortField === field ? 1 : 0.4,
                  transform: sortField === field && sortDir === "asc" ? "scaleY(-1)" : "none",
                }}
              />
            </button>
          ))}
        </div>

        {/* Data rows */}
        {sorted.length === 0 ? (
          <p className="py-8 text-center" style={{ color: "var(--text-muted)", fontSize: 13 }}>
            {t("dashboard.noProjects")}
          </p>
        ) : (
          sorted.map((row) => (
            <button
              key={row.id}
              onClick={() => onSelectProject(row.id)}
              className="grid gap-2 px-4 py-3.5 w-full text-left transition-all duration-200 hover:bg-surface-elevated"
              style={{
                gridTemplateColumns: "2fr 1fr 1fr 80px 80px 80px",
                borderBottom: "1px solid var(--border-subtle)",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-surface-hover)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >
              {/* Project name */}
              <div>
                <span style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>
                  {row.name}
                </span>
                {row.status === "archived" && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8, opacity: 0.7 }}>
                    {t("overview.archived")}
                  </span>
                )}
              </div>

              {/* Last activity */}
              <span className="font-mono tabular-nums" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {row.last_session_at
                  ? formatDistanceToNow(new Date(row.last_session_at), { addSuffix: true })
                  : "\u2014"}
              </span>

              {/* Progress */}
              <div style={{ paddingTop: 3 }}>
                <ProgressBar percent={row.progress_percent} />
              </div>

              {/* Sessions */}
              <span className="font-mono tabular-nums" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {row.session_count}
              </span>

              {/* Time */}
              <span className="font-mono tabular-nums" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {row.total_minutes > 0 ? `${row.total_minutes}m` : "\u2014"}
              </span>

              {/* Cost */}
              <span
                className="font-mono tabular-nums"
                style={{
                  fontSize: 12,
                  color: row.total_cost > 1 ? "#f59e0b" : row.total_cost > 0 ? "#22c55e" : "var(--text-muted)",
                }}
              >
                {row.total_cost > 0 ? `$${row.total_cost.toFixed(2)}` : "\u2014"}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
