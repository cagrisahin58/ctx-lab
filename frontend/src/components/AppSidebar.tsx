import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";
import { useProjects } from "../hooks/useProjects";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";

export function AppSidebar({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const { projects, loading } = useProjects();
  const navigate = useNavigate();
  const location = useLocation();

  const active = projects.filter(p => p.status === "active");

  // Extract current project id from URL
  const match = location.pathname.match(/^\/project\/([^/]+)/);
  const currentProjectId = match?.[1] ?? null;

  if (loading) {
    return (
      <div className="px-2 space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="space-y-1.5 p-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (active.length === 0) {
    return (
      <p className="px-3 py-8 text-center text-xs"
        style={{ color: "hsl(var(--muted-foreground))" }}>
        {t("dashboard.noProjects")}
      </p>
    );
  }

  return (
    <div className="px-1 space-y-0.5">
      {active.map(p => {
        const isSelected = p.id === currentProjectId;

        if (collapsed) {
          return (
            <Tooltip key={p.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => navigate(`/project/${p.id}`)}
                  className={cn(
                    "w-full flex items-center justify-center rounded-md h-8 transition-colors",
                    isSelected
                      ? "bg-[hsl(var(--sidebar-accent))]"
                      : "hover:bg-[hsl(var(--sidebar-accent))]"
                  )}
                >
                  <Layers size={16} style={{
                    color: isSelected
                      ? "hsl(var(--sidebar-primary))"
                      : "hsl(var(--sidebar-foreground))"
                  }} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {p.name} {p.progress_percent > 0 ? `(${p.progress_percent}%)` : ""}
              </TooltipContent>
            </Tooltip>
          );
        }

        return (
          <button
            key={p.id}
            onClick={() => navigate(`/project/${p.id}`)}
            className={cn(
              "w-full text-left px-2 py-2 rounded-md transition-colors",
              isSelected
                ? "bg-[hsl(var(--sidebar-accent))]"
                : "hover:bg-[hsl(var(--sidebar-accent))]"
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Layers size={14} className="flex-shrink-0" style={{
                color: isSelected
                  ? "hsl(var(--sidebar-primary))"
                  : "hsl(var(--muted-foreground))"
              }} />
              <span className={cn(
                "text-sm truncate",
                isSelected ? "font-semibold" : "font-medium"
              )} style={{
                color: isSelected
                  ? "hsl(var(--sidebar-primary))"
                  : "hsl(var(--sidebar-foreground))"
              }}>
                {p.name}
              </span>
              {p.progress_percent > 0 && (
                <Badge variant="secondary" className="ml-auto text-[10px] h-5 px-1.5 font-mono">
                  {p.progress_percent}%
                </Badge>
              )}
            </div>
            {p.last_summary && (
              <p className="text-xs mt-1 line-clamp-1 pl-6"
                style={{ color: "hsl(var(--muted-foreground))" }}>
                {p.last_summary.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
