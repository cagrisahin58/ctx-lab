import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ProgressBar } from "./ProgressBar";
import type { ProjectSummary } from "../lib/types";

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const navigate = useNavigate();

  const relativeTime = project.last_session_at
    ? formatDistanceToNow(new Date(project.last_session_at), { addSuffix: true })
    : null;

  return (
    <div
      onClick={() => navigate(`/project/${project.id}`)}
      className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 cursor-pointer hover:shadow-md transition-shadow"
    >
      <h3 className="font-bold text-gray-900 dark:text-white mb-1">
        {project.name}
      </h3>
      {project.last_summary && (
        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
          {project.last_summary}
        </p>
      )}
      <ProgressBar percent={project.progress_percent} />
      <div className="flex items-center justify-between mt-3 text-xs text-gray-500 dark:text-gray-400">
        {project.last_machine && (
          <span className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
            {project.last_machine}
          </span>
        )}
        {relativeTime && <span>{relativeTime}</span>}
      </div>
    </div>
  );
}
