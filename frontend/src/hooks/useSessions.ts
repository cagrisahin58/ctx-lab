import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/tauri";
import { useTauriEvent } from "./useTauriEvent";
import type { SessionInfo } from "../lib/types";

export function useSessions(
  projectId: string | undefined,
  limit: number = 20
) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await api.getSessions(projectId, limit);
      setSessions(data);
    } catch (e) {
      console.error("Failed to fetch sessions:", e);
    } finally {
      setLoading(false);
    }
  }, [projectId, limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useTauriEvent("ctx-lab-refresh", refresh);

  return { sessions, loading, refresh };
}
