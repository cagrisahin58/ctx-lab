export interface ProjectSummary {
  id: string;
  name: string;
  status: "active" | "archived";
  progress_percent: number;
  last_session_at: string | null;
  last_machine: string | null;
  last_summary: string | null;
  session_count: number;
  total_minutes: number;
}

export interface ProjectDetail extends ProjectSummary {
  roadmap: RoadmapData;
  recent_sessions: SessionInfo[];
}

export interface SessionInfo {
  id: string;
  project_id: string;
  machine: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  summary: string;
  next_steps: string;
  files_changed: number;
  recovered: boolean;
  transcript_highlights: string[];
}

export interface RoadmapData {
  items: RoadmapItem[];
  progress_percent: number;
}

export interface RoadmapItem {
  phase: string | null;
  item_text: string;
  status: "done" | "active" | "pending" | "suspended" | "blocked";
}

export interface Decision {
  date: string | null;
  title: string;
  description: string;
}

export interface AppConfig {
  privacy_mode: string;
  checkpoint_interval_minutes: number;
  sanitize_secrets: boolean;
}
