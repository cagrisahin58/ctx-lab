import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/tauri";
import { useTauriEvent } from "./useTauriEvent";
import type { ProjectSummary } from "../lib/types";

export function useProjects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getProjects();
      setProjects(data);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useTauriEvent("ctx-lab-refresh", refresh);

  return { projects, loading, error, refresh };
}
