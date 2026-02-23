import { Check, PlayCircle, Circle, PauseCircle, AlertCircle, MapPin, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProgressBar } from "./ProgressBar";
import type { RoadmapData, RoadmapItem } from "../lib/types";

const statusConfig: Record<
  RoadmapItem["status"],
  { icon: typeof Check; color: string }
> = {
  done: { icon: Check, color: "hsl(var(--success))" },
  active: { icon: PlayCircle, color: "hsl(var(--primary))" },
  pending: { icon: Circle, color: "hsl(var(--muted-foreground))" },
  suspended: { icon: PauseCircle, color: "hsl(var(--warning))" },
  blocked: { icon: AlertCircle, color: "#ef4444" },
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

  return (
    <div
      className="flex items-start gap-1.5 py-0.5"
      style={{ paddingLeft: depth * 16 }}
    >
      <Icon size={13} className="mt-0.5 flex-shrink-0" style={{ color: cfg.color }} />
      <span
        style={{
          fontSize: 12,
          lineHeight: "1.4",
          color: item.status === "done" ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
          textDecoration: item.status === "done" ? "line-through" : "none",
        }}
      >
        {item.item_text}
        {item.item_id && (
          <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginLeft: 4 }}>
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
      className="rounded-md px-3 py-2 mb-2"
      style={{
        background: "hsl(var(--warning) / 0.1)",
        border: "1px solid hsl(var(--warning) / 0.3)",
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <AlertTriangle size={12} style={{ color: "hsl(var(--warning))" }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--warning))" }}>
          Dependency warnings
        </span>
      </div>
      {warnings.map((w, i) => (
        <p key={i} style={{ fontSize: 11, color: "hsl(var(--warning))", margin: 0, paddingLeft: 18 }}>
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
        className="flex items-center gap-2 rounded-lg px-3 py-3"
        style={{ border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
      >
        <MapPin size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
        <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
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
      className="rounded-lg p-3"
      style={{ border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
    >
      <WarningBanner warnings={warnings} />
      <div className="mb-3">
        <ProgressBar percent={roadmap.progress_percent} />
      </div>
      {Array.from(phases.entries()).map(([phase, items]) => (
        <div key={phase} className="mb-2">
          <h3
            className="font-semibold uppercase tracking-wider mb-0.5"
            style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}
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
