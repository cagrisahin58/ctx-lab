import { Check, PlayCircle, Circle, PauseCircle, AlertCircle, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProgressBar } from "./ProgressBar";
import type { RoadmapData, RoadmapItem } from "../lib/types";

const statusConfig: Record<
  RoadmapItem["status"],
  { icon: typeof Check; color: string }
> = {
  done: { icon: Check, color: "#22c55e" },
  active: { icon: PlayCircle, color: "var(--accent)" },
  pending: { icon: Circle, color: "var(--text-muted)" },
  suspended: { icon: PauseCircle, color: "#f59e0b" },
  blocked: { icon: AlertCircle, color: "#ef4444" },
};

function RoadmapItemRow({ item }: { item: RoadmapItem }) {
  const cfg = statusConfig[item.status];
  const Icon = cfg.icon;

  return (
    <div className="flex items-start gap-1.5 py-0.5">
      <Icon size={13} className="mt-0.5 flex-shrink-0" style={{ color: cfg.color }} />
      <span
        style={{
          fontSize: 12,
          lineHeight: "1.4",
          color: item.status === "done" ? "var(--text-muted)" : "var(--text-primary)",
          textDecoration: item.status === "done" ? "line-through" : "none",
        }}
      >
        {item.item_text}
      </span>
    </div>
  );
}

export function RoadmapView({ roadmap }: { roadmap: RoadmapData }) {
  const { t } = useTranslation();

  if (roadmap.items.length === 0) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-3"
        style={{ border: "1px solid var(--border-default)", background: "var(--bg-surface)" }}
      >
        <MapPin size={14} style={{ color: "var(--text-muted)" }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("project.noRoadmap")}
        </span>
      </div>
    );
  }

  const phases = new Map<string, RoadmapItem[]>();
  const noPhase: RoadmapItem[] = [];

  for (const item of roadmap.items) {
    if (item.phase) {
      const list = phases.get(item.phase) ?? [];
      list.push(item);
      phases.set(item.phase, list);
    } else {
      noPhase.push(item);
    }
  }

  return (
    <div
      className="rounded-lg p-3"
      style={{ border: "1px solid var(--border-default)", background: "var(--bg-surface)" }}
    >
      <div className="mb-3">
        <ProgressBar percent={roadmap.progress_percent} />
      </div>
      {Array.from(phases.entries()).map(([phase, items]) => (
        <div key={phase} className="mb-2">
          <h3
            className="font-semibold uppercase tracking-wider mb-0.5"
            style={{ fontSize: 10, color: "var(--text-muted)" }}
          >
            {phase}
          </h3>
          {items.map((item, i) => (
            <RoadmapItemRow key={i} item={item} />
          ))}
        </div>
      ))}
      {noPhase.length > 0 && (
        <div>
          {noPhase.map((item, i) => (
            <RoadmapItemRow key={i} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
