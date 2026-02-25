import { Check, PlayCircle, Circle, PauseCircle, AlertCircle, MapPin, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProgressBar } from "./ProgressBar";
import type { RoadmapData, RoadmapItem } from "../lib/types";

const statusConfig: Record<
  RoadmapItem["status"],
  { icon: typeof Check; color: string; glow: string }
> = {
  done: { icon: Check, color: "#22c55e", glow: "rgba(34, 197, 94, 0.25)" },
  active: { icon: PlayCircle, color: "var(--accent)", glow: "rgba(99, 102, 241, 0.3)" },
  pending: { icon: Circle, color: "var(--text-muted)", glow: "transparent" },
  suspended: { icon: PauseCircle, color: "#f59e0b", glow: "rgba(245, 158, 11, 0.2)" },
  blocked: { icon: AlertCircle, color: "#ef4444", glow: "rgba(239, 68, 68, 0.2)" },
};

// ---------------------------------------------------------------------------
// Tree building for dependency visualization
// ---------------------------------------------------------------------------

interface TreeNode {
  item: RoadmapItem;
  children: TreeNode[];
  depth: number;
}

/** Check whether any item in the list uses id/depends attributes. */
function hasDependencyInfo(items: RoadmapItem[]): boolean {
  return items.some((i) => i.item_id || i.depends_on.length > 0);
}

/**
 * Build a tree from items that have dependency information.
 * - Items without depends_on are roots (depth 0).
 * - Items with depends_on are children of their last dependency.
 * - If a dependency target is not found, the item becomes a root.
 */
function buildTree(items: RoadmapItem[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Create nodes for all items
  const allNodes: TreeNode[] = items.map((item) => ({
    item,
    children: [],
    depth: 0,
  }));

  // Index by item_id
  for (const node of allNodes) {
    if (node.item.item_id) {
      nodeMap.set(node.item.item_id, node);
    }
  }

  // Build parent-child relationships
  for (const node of allNodes) {
    if (node.item.depends_on.length === 0) {
      roots.push(node);
    } else {
      // Attach to the last dependency that exists
      const lastDep = node.item.depends_on[node.item.depends_on.length - 1];
      const parent = nodeMap.get(lastDep);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }

  // Assign depths via BFS (with visited guard against cycles)
  const queue = [...roots];
  const visited = new Set<TreeNode>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const child of current.children) {
      child.depth = current.depth + 1;
      queue.push(child);
    }
  }

  return roots;
}

/** Flatten tree into ordered list with depth info for rendering. */
function flattenTree(nodes: TreeNode[]): { item: RoadmapItem; depth: number }[] {
  const result: { item: RoadmapItem; depth: number }[] = [];
  function walk(node: TreeNode) {
    result.push({ item: node.item, depth: node.depth });
    for (const child of node.children) {
      walk(child);
    }
  }
  for (const root of nodes) {
    walk(root);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function RoadmapItemRow({ item, depth = 0 }: { item: RoadmapItem; depth?: number }) {
  const cfg = statusConfig[item.status];
  const Icon = cfg.icon;
  const isActive = item.status === "active";

  return (
    <div
      className="flex items-start gap-2 py-1.5 px-2 rounded-lg transition-all duration-200"
      style={{
        paddingLeft: depth * 16 + 8,
        background: isActive ? cfg.glow : "transparent",
        boxShadow: isActive ? `0 0 12px ${cfg.glow}` : "none",
      }}
    >
      <div
        className="mt-0.5 flex-shrink-0 transition-transform duration-200"
        style={{ color: cfg.color }}
      >
        <Icon size={14} />
      </div>
      <span
        className="leading-snug"
        style={{
          fontSize: 13,
          color: item.status === "done" ? "var(--text-muted)" : "var(--text-primary)",
          textDecoration: item.status === "done" ? "line-through" : "none",
        }}
      >
        {item.item_text}
        {item.item_id && (
          <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 6, opacity: 0.7 }}>
            [{item.item_id}]
          </span>
        )}
      </span>
    </div>
  );
}

function WarningBanner({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div
      className="rounded-lg px-3 py-2.5 mb-3"
      style={{
        background: "rgba(245, 158, 11, 0.12)",
        border: "1px solid rgba(245, 158, 11, 0.25)",
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle size={13} style={{ color: "#f59e0b" }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: "#f59e0b" }}>
          Dependency warnings
        </span>
      </div>
      {warnings.map((w, i) => (
        <p key={i} style={{ fontSize: 12, color: "#f59e0b", margin: 0, paddingLeft: 20, opacity: 0.85 }}>
          {w}
        </p>
      ))}
    </div>
  );
}

function renderPhaseItems(items: RoadmapItem[], useDeps: boolean) {
  if (!useDeps) {
    return items.map((item, i) => <RoadmapItemRow key={i} item={item} />);
  }

  const tree = buildTree(items);
  const flat = flattenTree(tree);
  return flat.map((entry, i) => (
    <RoadmapItemRow key={i} item={entry.item} depth={entry.depth} />
  ));
}

export function RoadmapView({ roadmap }: { roadmap: RoadmapData }) {
  const { t } = useTranslation();

  if (roadmap.items.length === 0) {
    return (
      <div
        className="flex items-center gap-2 rounded-xl px-4 py-4 glass-card"
        style={{ border: "1px solid var(--border-subtle)", background: "var(--bg-surface)" }}
      >
        <MapPin size={15} style={{ color: "var(--text-muted)" }} />
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("project.noRoadmap")}
        </span>
      </div>
    );
  }

  const useDeps = hasDependencyInfo(roadmap.items);
  const warnings = roadmap.warnings ?? [];

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
      className="rounded-xl p-4 glass-card"
      style={{ border: "1px solid var(--border-subtle)", background: "var(--bg-surface)" }}
    >
      <WarningBanner warnings={warnings} />
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
          {renderPhaseItems(items, useDeps)}
        </div>
      ))}
      {noPhase.length > 0 && (
        <div>
          {renderPhaseItems(noPhase, useDeps)}
        </div>
      )}
    </div>
  );
}
