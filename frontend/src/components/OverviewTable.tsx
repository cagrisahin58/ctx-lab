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
        <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Show archived toggle */}
      <div className="flex items-center justify-end mb-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="rounded"
            style={{ accentColor: "hsl(var(--primary))" }}
          />
          <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
            {t("overview.showArchived")}
          </span>
        </label>
      </div>

      <div
        className="rounded-lg overflow-hidden"
        style={{ border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
      >
        {/* Header row */}
        <div
          className="grid gap-2 px-3 py-2"
          style={{
            gridTemplateColumns: "2fr 1fr 1fr 80px 80px 80px",
            borderBottom: "1px solid hsl(var(--border))",
            background: "hsl(var(--background))",
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
              className="flex items-center gap-1 font-semibold uppercase tracking-wider text-left"
              style={{ fontSize: 10, color: sortField === field ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}
            >
              {label}
              <ArrowUpDown size={10} />
            </button>
          ))}
        </div>

        {/* Data rows */}
        {sorted.length === 0 ? (
          <p className="py-6 text-center text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
            {t("dashboard.noProjects")}
          </p>
        ) : (
          sorted.map((row) => (
            <button
              key={row.id}
              onClick={() => onSelectProject(row.id)}
              className="grid gap-2 px-3 py-2.5 w-full text-left transition-colors hover:bg-[hsl(var(--muted))]/50"
              style={{
                gridTemplateColumns: "2fr 1fr 1fr 80px 80px 80px",
                borderBottom: "1px solid hsl(var(--border))",
              }}
            >
              {/* Project name */}
              <div>
                <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
                  {row.name}
                </span>
                {row.status === "archived" && (
                  <span className="text-[10px] ml-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {t("overview.archived")}
                  </span>
                )}
              </div>

              {/* Last activity */}
              <span className="font-mono tabular-nums text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                {row.last_session_at
                  ? formatDistanceToNow(new Date(row.last_session_at), { addSuffix: true })
                  : "\u2014"}
              </span>

              {/* Progress */}
              <div style={{ paddingTop: 2 }}>
                <ProgressBar percent={row.progress_percent} />
              </div>

              {/* Sessions */}
              <span className="font-mono tabular-nums text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                {row.session_count}
              </span>

              {/* Time */}
              <span className="font-mono tabular-nums text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                {row.total_minutes > 0 ? `${row.total_minutes}m` : "\u2014"}
              </span>

              {/* Cost */}
              <span
                className="font-mono tabular-nums text-xs"
                style={{
                  color: row.total_cost > 1 ? "hsl(var(--warning))" : row.total_cost > 0 ? "hsl(var(--success))" : "hsl(var(--muted-foreground))",
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
