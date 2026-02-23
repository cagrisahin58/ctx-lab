import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layers, Settings, BarChart3, RefreshCw, Sun } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "./ui/command";
import { useProjects } from "../hooks/useProjects";
import { api } from "../lib/tauri";

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projects, refresh } = useProjects();

  const runAction = (fn: () => void) => {
    fn();
    onOpenChange(false);
  };

  const toggleTheme = () => {
    const isDark = document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", !isDark);
    localStorage.setItem("theme", isDark ? "light" : "dark");
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={t("common.search")} />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Projects">
          {projects.filter(p => p.status === "active").map(p => (
            <CommandItem
              key={p.id}
              onSelect={() => runAction(() => navigate(`/project/${p.id}`))}
            >
              <Layers className="mr-2 h-4 w-4" />
              {p.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Pages">
          <CommandItem onSelect={() => runAction(() => navigate("/"))}>
            <BarChart3 className="mr-2 h-4 w-4" />
            Overview
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => navigate("/settings"))}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => runAction(async () => {
            await api.rebuildCache();
            await refresh();
          })}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Rebuild Cache
          </CommandItem>
          <CommandItem onSelect={() => runAction(toggleTheme)}>
            <Sun className="mr-2 h-4 w-4" />
            Toggle Theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
