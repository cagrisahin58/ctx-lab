import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, LayoutGrid, List, Inbox } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { api } from "../lib/tauri";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import { Skeleton } from "../components/ui/skeleton";
import { Card, CardContent } from "../components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../components/ui/table";
import type { OverviewRow } from "../lib/types";

type SortField = "name" | "last_session_at" | "progress_percent" | "session_count" | "total_minutes" | "total_cost";
type SortDir = "asc" | "desc";
type ViewMode = "table" | "grid";

/* ── Sub-components ── */

interface TableViewProps {
  rows: OverviewRow[];
  sortField: SortField;
  toggleSort: (field: SortField) => void;
  navigate: ReturnType<typeof useNavigate>;
  t: ReturnType<typeof useTranslation>["t"];
}

function SortHeader({
  field,
  label,
  sortField,
  toggleSort,
  className,
}: {
  field: SortField;
  label: string;
  sortField: SortField;
  toggleSort: (f: SortField) => void;
  className?: string;
}) {
  const isActive = sortField === field;
  return (
    <TableHead className={className}>
      <button
        onClick={() => toggleSort(field)}
        className={cn(
          "flex items-center gap-1 text-xs font-medium uppercase tracking-wider transition-colors",
          isActive ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"
        )}
      >
        {label}
        <ArrowUpDown size={10} className={isActive ? "opacity-100" : "opacity-40"} />
      </button>
    </TableHead>
  );
}

function TableView({ rows, sortField, toggleSort, navigate, t }: TableViewProps) {
  if (rows.length === 0) {
    return <EmptyState t={t} />;
  }

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHeader field="name" label={t("overview.project")} sortField={sortField} toggleSort={toggleSort} className="w-[240px]" />
            <SortHeader field="last_session_at" label={t("overview.lastActivity")} sortField={sortField} toggleSort={toggleSort} />
            <SortHeader field="progress_percent" label={t("overview.progress")} sortField={sortField} toggleSort={toggleSort} className="w-[160px]" />
            <SortHeader field="session_count" label={t("overview.sessions")} sortField={sortField} toggleSort={toggleSort} className="w-[80px]" />
            <SortHeader field="total_minutes" label={t("overview.time")} sortField={sortField} toggleSort={toggleSort} className="w-[80px]" />
            <SortHeader field="total_cost" label={t("overview.cost")} sortField={sortField} toggleSort={toggleSort} className="w-[80px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              className="cursor-pointer"
              onClick={() => navigate(`/project/${row.id}`)}
            >
              {/* Name + status */}
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <span className="text-[hsl(var(--foreground))]">{row.name}</span>
                  {row.status === "archived" && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {t("overview.archived")}
                    </Badge>
                  )}
                </div>
              </TableCell>

              {/* Last activity */}
              <TableCell>
                <span className="font-mono tabular-nums text-xs text-[hsl(var(--muted-foreground))]">
                  {row.last_session_at
                    ? formatDistanceToNow(new Date(row.last_session_at), { addSuffix: true })
                    : "\u2014"}
                </span>
              </TableCell>

              {/* Progress */}
              <TableCell>
                <div className="flex items-center gap-2">
                  <Progress value={row.progress_percent} className="h-1.5 flex-1" />
                  <span className="font-mono tabular-nums text-[11px] text-[hsl(var(--muted-foreground))] w-8 text-right">
                    {Math.round(row.progress_percent)}%
                  </span>
                </div>
              </TableCell>

              {/* Sessions */}
              <TableCell>
                <span className="font-mono tabular-nums text-xs text-[hsl(var(--muted-foreground))]">
                  {row.session_count}
                </span>
              </TableCell>

              {/* Time */}
              <TableCell>
                <span className="font-mono tabular-nums text-xs text-[hsl(var(--muted-foreground))]">
                  {row.total_minutes > 0 ? `${row.total_minutes}m` : "\u2014"}
                </span>
              </TableCell>

              {/* Cost */}
              <TableCell>
                <span
                  className={cn(
                    "font-mono tabular-nums text-xs",
                    row.total_cost >= 1
                      ? "text-[hsl(var(--warning))]"
                      : row.total_cost > 0
                        ? "text-[hsl(var(--success))]"
                        : "text-[hsl(var(--muted-foreground))]"
                  )}
                >
                  {row.total_cost > 0 ? `$${row.total_cost.toFixed(2)}` : "\u2014"}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface GridViewProps {
  rows: OverviewRow[];
  navigate: ReturnType<typeof useNavigate>;
  t: ReturnType<typeof useTranslation>["t"];
}

function GridView({ rows, navigate, t }: GridViewProps) {
  if (rows.length === 0) {
    return <EmptyState t={t} />;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {rows.map((row) => (
        <Card
          key={row.id}
          className="cursor-pointer transition-colors hover:bg-[hsl(var(--muted))]/50"
          onClick={() => navigate(`/project/${row.id}`)}
        >
          <CardContent className="p-4">
            {/* Title */}
            <div className="flex items-center gap-2 mb-3">
              <span className="font-medium text-sm text-[hsl(var(--foreground))] truncate">
                {row.name}
              </span>
              {row.status === "archived" && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                  {t("overview.archived")}
                </Badge>
              )}
            </div>

            {/* Progress */}
            <div className="flex items-center gap-2 mb-3">
              <Progress value={row.progress_percent} className="h-1.5 flex-1" />
              <span className="font-mono tabular-nums text-[11px] text-[hsl(var(--muted-foreground))] w-8 text-right">
                {Math.round(row.progress_percent)}%
              </span>
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-3 text-[11px]">
              <span className="font-mono tabular-nums text-[hsl(var(--muted-foreground))]">
                {row.session_count} sessions
              </span>
              {row.total_minutes > 0 && (
                <span className="font-mono tabular-nums text-[hsl(var(--muted-foreground))]">
                  {row.total_minutes}m
                </span>
              )}
              {row.total_cost > 0 && (
                <span
                  className={cn(
                    "font-mono tabular-nums",
                    row.total_cost >= 1
                      ? "text-[hsl(var(--warning))]"
                      : "text-[hsl(var(--success))]"
                  )}
                >
                  ${row.total_cost.toFixed(2)}
                </span>
              )}
            </div>

            {/* Last activity */}
            {row.last_session_at && (
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-2">
                {formatDistanceToNow(new Date(row.last_session_at), { addSuffix: true })}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyState({ t }: { t: ReturnType<typeof useTranslation>["t"] }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <Inbox size={32} className="text-[hsl(var(--muted-foreground))]" />
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        {t("dashboard.noProjects")}
      </p>
    </div>
  );
}

/* ── Main component ── */

export function Overview() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sortField, setSortField] = useState<SortField>("last_session_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("table");

  useEffect(() => {
    setLoading(true);
    api.getOverview(includeArchived).then(setRows).finally(() => setLoading(false));
  }, [includeArchived]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortField) {
      case "name": return dir * a.name.localeCompare(b.name);
      case "last_session_at": return dir * ((a.last_session_at ?? "").localeCompare(b.last_session_at ?? ""));
      case "progress_percent": return dir * (a.progress_percent - b.progress_percent);
      case "session_count": return dir * (a.session_count - b.session_count);
      case "total_minutes": return dir * (a.total_minutes - b.total_minutes);
      case "total_cost": return dir * (a.total_cost - b.total_cost);
      default: return 0;
    }
  });

  return (
    <div className="max-w-5xl mx-auto px-8 py-6">
      {/* Title row */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-[hsl(var(--foreground))]">
          {t("overview.title")}
        </h1>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center rounded-md border border-[hsl(var(--border))]">
            <Button
              variant={viewMode === "table" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8 rounded-r-none"
              onClick={() => setViewMode("table")}
            >
              <List size={14} />
            </Button>
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8 rounded-l-none"
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid size={14} />
            </Button>
          </div>
          {/* Archived toggle */}
          <label className="flex items-center gap-2 cursor-pointer text-xs text-[hsl(var(--muted-foreground))]">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={e => setIncludeArchived(e.target.checked)}
              className="rounded"
              style={{ accentColor: "hsl(var(--primary))" }}
            />
            {t("overview.showArchived")}
          </label>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : viewMode === "table" ? (
        <TableView rows={sorted} sortField={sortField} toggleSort={toggleSort} navigate={navigate} t={t} />
      ) : (
        <GridView rows={sorted} navigate={navigate} t={t} />
      )}
    </div>
  );
}
