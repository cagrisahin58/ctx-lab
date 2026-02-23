import { useState, useEffect } from "react";
import { Outlet, useLocation, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  PanelLeftClose, PanelLeft, Settings, Layers, Search,
  ChevronRight,
} from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { Button } from "./ui/button";
import { ThemeToggle } from "./ThemeToggle";
import { ZoomControl } from "./ZoomControl";
import { AppSidebar } from "./AppSidebar";
import { CommandPalette } from "./CommandPalette";

export function AppLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem("seslog-sidebar-collapsed") === "true"
  );
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("seslog-sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  // Cmd+K handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen(prev => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Build breadcrumbs from location
  const breadcrumbs = buildBreadcrumbs(location.pathname);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen" style={{ background: "hsl(var(--background))" }}>
        {/* Sidebar */}
        <aside
          className="flex flex-col flex-shrink-0 transition-all duration-200"
          style={{
            width: collapsed ? 48 : 240,
            borderRight: "1px solid hsl(var(--sidebar-border))",
            background: "hsl(var(--sidebar-background))",
          }}
        >
          {/* Sidebar header */}
          <div className="flex items-center justify-between px-2 h-11"
            style={{ borderBottom: "1px solid hsl(var(--sidebar-border))" }}>
            {!collapsed && (
              <div className="flex items-center gap-2 px-1">
                <Layers size={16} style={{ color: "hsl(var(--sidebar-primary))" }} />
                <span className="font-semibold text-sm tracking-tight"
                  style={{ color: "hsl(var(--sidebar-foreground))" }}>
                  Seslog
                </span>
              </div>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => setCollapsed(c => !c)}>
              {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
            </Button>
          </div>

          {/* Search button */}
          {!collapsed ? (
            <button
              onClick={() => setCommandOpen(true)}
              className="flex items-center gap-2 mx-2 mt-2 px-2 py-1.5 rounded-md text-xs transition-colors"
              style={{
                border: "1px solid hsl(var(--sidebar-border))",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              <Search size={14} />
              <span className="flex-1 text-left">{t("common.search")}</span>
              <kbd className="font-mono text-[10px] px-1 rounded"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                {"\u2318"}K
              </kbd>
            </button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="mx-auto mt-2 h-7 w-7"
                  onClick={() => setCommandOpen(true)}>
                  <Search size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Search ({"\u2318"}K)</TooltipContent>
            </Tooltip>
          )}

          {/* Project list */}
          <ScrollArea className="flex-1 mt-2">
            <AppSidebar collapsed={collapsed} />
          </ScrollArea>

          {/* Footer */}
          <div className="flex items-center justify-between px-2 h-10"
            style={{ borderTop: "1px solid hsl(var(--sidebar-border))" }}>
            {!collapsed && <ZoomControl />}
            <div className="flex items-center gap-0.5">
              <ThemeToggle />
              {!collapsed ? (
                <Link to="/settings">
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Settings size={15} />
                  </Button>
                </Link>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link to="/settings">
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <Settings size={15} />
                      </Button>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">Settings</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </aside>

        {/* Main area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Breadcrumb header */}
          <header className="flex items-center gap-2 px-4 h-11 flex-shrink-0"
            style={{ borderBottom: "1px solid hsl(var(--border))" }}>
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-2">
                {i > 0 && <ChevronRight size={12} style={{ color: "hsl(var(--muted-foreground))" }} />}
                {crumb.href ? (
                  <Link to={crumb.href} className="text-xs hover:underline"
                    style={{ color: "hsl(var(--muted-foreground))" }}>
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-xs font-medium"
                    style={{ color: "hsl(var(--foreground))" }}>
                    {crumb.label}
                  </span>
                )}
              </span>
            ))}
          </header>

          {/* Content */}
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>

        {/* Command palette */}
        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      </div>
    </TooltipProvider>
  );
}

interface Breadcrumb {
  label: string;
  href?: string;
}

function buildBreadcrumbs(pathname: string): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ label: "Home", href: "/" }];
  const parts = pathname.split("/").filter(Boolean);

  if (parts[0] === "project" && parts[1]) {
    crumbs.push({ label: decodeURIComponent(parts[1]), href: `/project/${parts[1]}` });
    if (parts[2] === "session" && parts[3]) {
      crumbs.push({ label: "Session" });
    }
  } else if (parts[0] === "settings") {
    crumbs.push({ label: "Settings" });
  }

  return crumbs;
}
