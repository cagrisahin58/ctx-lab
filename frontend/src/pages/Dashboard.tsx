import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { RefreshCw, Settings, Layers, BarChart3, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { api } from "../lib/tauri";
import { useProjects } from "../hooks/useProjects";
import { ThemeToggle } from "../components/ThemeToggle";
import { ZoomControl } from "../components/ZoomControl";
import { RoadmapView } from "../components/RoadmapView";
import { SessionList } from "../components/SessionList";
import { OverviewTable } from "../components/OverviewTable";
import type { ProjectDetail } from "../lib/types";

function cleanSummary(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function Dashboard() {
  const { t } = useTranslation();
  const { projects, loading, refresh } = useProjects();
  const [rebuilding, setRebuilding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showOverview, setShowOverview] = useState(false);

  // Migration toast: show once after bundle-id rename if old keys exist
  const [showMigrationBanner, setShowMigrationBanner] = useState(() => {
    if (localStorage.getItem("seslog-migrated")) return false;
    const hasOldKeys =
      localStorage.getItem("ctx-lab-zoom") !== null ||
      localStorage.getItem("ctx-lab-language") !== null;
    return hasOldKeys;
  });

  const dismissMigration = () => {
    localStorage.setItem("seslog-migrated", "1");
    setShowMigrationBanner(false);
  };

  const active = projects.filter((p) => p.status === "active");

  // Auto-select first project
  useEffect(() => {
    if (active.length > 0 && !selectedId) {
      setSelectedId(active[0].id);
    }
  }, [active, selectedId]);

  // Load detail when selection changes
  useEffect(() => {
    if (!selectedId) return;
    setDetailLoading(true);
    api
      .getProjectDetail(selectedId)
      .then(setDetail)
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: "var(--bg-app)" }}>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen" style={{ background: "var(--bg-app)" }}>
      {/* ─── Sidebar ─── */}
      <aside
        className="flex flex-col flex-shrink-0 glass-panel"
        style={{
          width: 280,
          borderRight: "1px solid var(--border-subtle)",
          background: "var(--bg-surface)",
        }}
      >
        {/* Sidebar header */}
        <div
          className="flex items-center justify-between px-4"
          style={{
            height: 56,
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Layers size={18} style={{ color: "var(--accent)" }} />
              <Sparkles
                size={8}
                className="absolute -top-0.5 -right-0.5"
                style={{ color: "var(--accent-glow)" }}
              />
            </div>
            <span
              className="font-semibold tracking-tight"
              style={{ fontSize: 15, color: "var(--text-primary)" }}
            >
              {t("dashboard.title")}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setShowOverview(!showOverview)}
              className="flex items-center justify-center rounded-lg transition-all duration-200 hover:scale-105"
              style={{
                width: 32,
                height: 32,
                color: showOverview ? "var(--accent)" : "var(--text-muted)",
                background: showOverview ? "var(--accent-subtle)" : "transparent",
              }}
              onMouseEnter={(e) => {
                if (!showOverview) e.currentTarget.style.background = "var(--bg-surface-hover)";
              }}
              onMouseLeave={(e) => {
                if (!showOverview) e.currentTarget.style.background = "transparent";
              }}
              title={t("overview.title")}
            >
              <BarChart3 size={15} />
            </button>
            <button
              onClick={async () => {
                setRebuilding(true);
                try {
                  await api.rebuildCache();
                  await refresh();
                } finally {
                  setRebuilding(false);
                }
              }}
              disabled={rebuilding}
              className="flex items-center justify-center rounded-lg transition-all duration-200 hover:scale-105"
              style={{
                width: 32,
                height: 32,
                color: "var(--text-muted)",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-surface-hover)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              title={t("dashboard.rebuildCache")}
            >
              <RefreshCw size={15} className={rebuilding ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Project list */}
        <div className="flex-1 overflow-y-auto py-1">
          {active.length === 0 ? (
            <p
              className="px-4 py-10 text-center"
              style={{ color: "var(--text-muted)", fontSize: 12 }}
            >
              {t("dashboard.noProjects")}
            </p>
          ) : (
            active.map((p) => {
              const isSelected = p.id === selectedId;
              const relTime = p.last_session_at
                ? formatDistanceToNow(new Date(p.last_session_at), { addSuffix: true })
                : null;

              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className="w-full text-left px-3 py-3 flex items-start gap-2.5 transition-all duration-200 relative hover:bg-surface-elevated group"
                  style={{
                    background: isSelected ? "var(--bg-sidebar-active)" : "transparent",
                    borderLeft: isSelected ? "3px solid var(--accent)" : "3px solid transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "var(--bg-surface-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="font-semibold truncate"
                        style={{
                          fontSize: 13,
                          color: isSelected ? "var(--accent)" : "var(--text-primary)",
                        }}
                      >
                        {p.name}
                      </span>
                      {p.progress_percent > 0 && (
                        <span
                          className="font-mono tabular-nums flex-shrink-0"
                          style={{ fontSize: 10, color: "var(--text-muted)" }}
                        >
                          {p.progress_percent}%
                        </span>
                      )}
                    </div>

                    {p.last_summary && (
                      <p
                        className="line-clamp-2 mt-0.5"
                        style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: "1.4" }}
                      >
                        {cleanSummary(p.last_summary)}
                      </p>
                    )}

                    <div className="flex items-center gap-2 mt-1">
                      {p.last_machine && (
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {p.last_machine.split(".")[0]}
                        </span>
                      )}
                      {relTime && (
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {relTime}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Sidebar footer toolbar */}
        <div
          className="flex items-center justify-between px-3"
          style={{
            height: 48,
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <ZoomControl />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Link
              to="/settings"
              className="flex items-center justify-center rounded-lg transition-all duration-200 hover:scale-105"
              style={{ width: 32, height: 32, color: "var(--text-muted)" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-surface-hover)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              title={t("settings.title")}
            >
              <Settings size={16} />
            </Link>
          </div>
        </div>
      </aside>

      {/* ─── Main content ─── */}
      <main className="flex-1 overflow-y-auto">
        {showOverview ? (
          <div className="max-w-5xl mx-auto px-8 py-6">
            <h1
              className="font-semibold mb-6"
              style={{ fontSize: 20, color: "var(--text-primary)" }}
            >
              {t("overview.title")}
            </h1>
            <OverviewTable
              onSelectProject={(id) => {
                setSelectedId(id);
                setShowOverview(false);
              }}
            />
          </div>
        ) : !selectedId || !detail ? (
          <div className="flex items-center justify-center h-full">
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
              {active.length === 0 ? t("dashboard.noProjects") : t("common.loading")}
            </p>
          </div>
        ) : detailLoading ? (
          <div className="flex items-center justify-center h-full">
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("common.loading")}</p>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto px-8 py-6">
            {/* Migration toast banner */}
            {showMigrationBanner && (
              <div
                className="flex items-center justify-between rounded-xl px-4 py-3 mb-4 glass-card"
                style={{
                  background: "rgba(245, 158, 11, 0.12)",
                  border: "1px solid rgba(245, 158, 11, 0.25)",
                }}
              >
                <span style={{ fontSize: 13, color: "#f59e0b" }}>
                  Seslog has been renamed. macOS permissions may need to be re-granted.
                </span>
                <button
                  onClick={dismissMigration}
                  style={{ color: "#f59e0b", fontSize: 14 }}
                >
                  &#10005;
                </button>
              </div>
            )}

            {/* Project header */}
            <div className="flex items-baseline justify-between mb-6">
              <h1
                className="font-semibold"
                style={{ fontSize: 24, color: "var(--text-primary)", letterSpacing: "-0.02em" }}
              >
                {detail.name}
              </h1>
              {detail.session_count > 0 && (
                <span
                  className="font-mono tabular-nums"
                  style={{ fontSize: 12, color: "var(--text-muted)" }}
                >
                  {detail.session_count} {t("project.sessions").toLowerCase()}
                  {detail.total_minutes > 0 && ` \u00b7 ${detail.total_minutes}m`}
                </span>
              )}
            </div>

            {/* Next steps banner */}
            {detail.recent_sessions.length > 0 &&
              detail.recent_sessions[0].next_steps && (
                <div
                  className="mb-6 flex items-start gap-3 rounded-xl px-4 py-3.5 glass-card"
                  style={{
                    background: "var(--accent-subtle)",
                    border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
                  }}
                >
                  <Sparkles size={14} className="flex-shrink-0 mt-0.5" style={{ color: "var(--accent)" }} />
                  <div>
                    <span
                      className="font-semibold uppercase tracking-wider"
                      style={{ fontSize: 10, color: "var(--accent)" }}
                    >
                      {t("project.nextSteps")}
                    </span>
                    <p style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: "1.5", marginTop: 2 }}>
                      {cleanSummary(detail.recent_sessions[0].next_steps)}
                    </p>
                  </div>
                </div>
              )}

            {/* Two columns: Roadmap (1/3) + Sessions (2/3) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1">
                <h2
                  className="font-semibold uppercase tracking-wider mb-3"
                  style={{ fontSize: 11, color: "var(--text-muted)" }}
                >
                  {t("project.roadmap")}
                </h2>
                <RoadmapView roadmap={detail.roadmap} />
              </div>
              <div className="lg:col-span-2">
                <h2
                  className="font-semibold uppercase tracking-wider mb-3"
                  style={{ fontSize: 11, color: "var(--text-muted)" }}
                >
                  {t("project.sessions")}
                </h2>
                <SessionList sessions={detail.recent_sessions} />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
