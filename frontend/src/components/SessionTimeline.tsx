import { format } from "date-fns";
import type { SessionInfo } from "../lib/types";

export function SessionTimeline({ sessions }: { sessions: SessionInfo[] }) {
  if (sessions.length === 0) {
    return (
      <p className="text-gray-500 dark:text-gray-400 text-sm">
        No sessions recorded yet.
      </p>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-gray-200 dark:bg-gray-700" />

        {sessions.map((session) => (
          <div key={session.id} className="relative pl-8 pb-6 last:pb-0">
            {/* Dot */}
            <div className="absolute left-0.5 top-1.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-white dark:border-gray-800" />

            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                {format(new Date(session.started_at), "MMM d, yyyy HH:mm")}
              </span>
              <span className="bg-gray-100 dark:bg-gray-700 text-xs px-2 py-0.5 rounded text-gray-600 dark:text-gray-400">
                {session.machine}
              </span>
              {session.recovered && (
                <span className="bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 text-xs px-2 py-0.5 rounded">
                  recovered
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mb-1">
              {session.duration_minutes != null && (
                <span>{session.duration_minutes}m</span>
              )}
              {session.files_changed > 0 && (
                <span>{session.files_changed} files changed</span>
              )}
            </div>

            {session.summary && (
              <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                {session.summary}
              </p>
            )}

            {session.next_steps && (
              <p className="text-sm italic text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                {session.next_steps}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
