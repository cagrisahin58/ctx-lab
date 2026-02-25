import { invoke } from "@tauri-apps/api/core";
import type {
  ProjectSummary,
  ProjectDetail,
  SessionInfo,
  RoadmapData,
  AppConfig,
  OverviewRow,
} from "./types";

export const api = {
  getProjects: () => invoke<ProjectSummary[]>("get_projects"),
  getProjectDetail: (projectId: string) =>
    invoke<ProjectDetail>("get_project_detail", { projectId }),
  getSessions: (projectId: string, limit: number = 20) =>
    invoke<SessionInfo[]>("get_sessions", { projectId, limit }),
  getRoadmap: (projectId: string) =>
    invoke<RoadmapData>("get_roadmap", { projectId }),
  rebuildCache: () =>
    invoke<{ added: number; removed: number; updated: number }>(
      "rebuild_cache"
    ),
  openInEditor: (projectId: string) =>
    invoke<void>("open_in_editor", { projectId }),
  getSettings: () => invoke<AppConfig>("get_settings"),
  updateSettings: (config: AppConfig) =>
    invoke<void>("update_settings", { config }),
  getOverview: (includeArchived?: boolean) =>
    invoke<OverviewRow[]>("get_overview", { includeArchived }),
};
