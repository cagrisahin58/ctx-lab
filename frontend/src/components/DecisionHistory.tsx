import { format } from "date-fns";
import type { Decision } from "../lib/types";

export function DecisionHistory({ decisions }: { decisions: Decision[] }) {
  if (decisions.length === 0) {
    return (
      <p className="text-gray-500 dark:text-gray-400 text-sm">
        No decisions recorded yet.
      </p>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-4">
      {decisions.map((d, i) => (
        <div key={i} className="border-b border-gray-100 dark:border-gray-700 pb-3 last:border-0 last:pb-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white">
              {d.title}
            </h4>
            {d.date && (
              <span className="text-xs text-gray-400">
                {format(new Date(d.date), "MMM d, yyyy")}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {d.description}
          </p>
        </div>
      ))}
    </div>
  );
}
