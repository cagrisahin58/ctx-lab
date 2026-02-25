import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/tauri";
import { useTauriEvent } from "./useTauriEvent";
import type { RoadmapData } from "../lib/types";

export function useRoadmap(projectId: string | undefined) {
  const [roadmap, setRoadmap] = useState<RoadmapData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await api.getRoadmap(projectId);
      setRoadmap(data);
    } catch (e) {
      console.error("Failed to fetch roadmap:", e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useTauriEvent("seslog-refresh", refresh);

  return { roadmap, loading, refresh };
}
