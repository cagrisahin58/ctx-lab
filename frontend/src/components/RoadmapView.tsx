import { Check, PlayCircle, Circle, PauseCircle, AlertCircle } from "lucide-react";
import { ProgressBar } from "./ProgressBar";
import type { RoadmapData, RoadmapItem } from "../lib/types";

const statusConfig: Record<
  RoadmapItem["status"],
  { icon: typeof Check; color: string }
> = {
  done: { icon: Check, color: "text-green-500" },
  active: { icon: PlayCircle, color: "text-blue-500" },
  pending: { icon: Circle, color: "text-gray-400" },
  suspended: { icon: PauseCircle, color: "text-yellow-500" },
  blocked: { icon: AlertCircle, color: "text-red-500" },
};

function RoadmapItemRow({ item }: { item: RoadmapItem }) {
  const cfg = statusConfig[item.status];
  const Icon = cfg.icon;

  return (
    <div className="flex items-start gap-2 py-1.5">
      <Icon size={16} className={`mt-0.5 flex-shrink-0 ${cfg.color}`} />
      <span
        className={`text-sm ${
          item.status === "done"
            ? "text-gray-400 dark:text-gray-500 line-through"
            : "text-gray-800 dark:text-gray-200"
        }`}
      >
        {item.item_text}
      </span>
    </div>
  );
}

export function RoadmapView({ roadmap }: { roadmap: RoadmapData }) {
  // Group items by phase
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
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
      <div className="mb-4">
        <ProgressBar percent={roadmap.progress_percent} />
      </div>
      {Array.from(phases.entries()).map(([phase, items]) => (
        <div key={phase} className="mb-4">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-1">
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
