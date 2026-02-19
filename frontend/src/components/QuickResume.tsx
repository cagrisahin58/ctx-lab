import { useTranslation } from "react-i18next";
import { ProgressBar } from "./ProgressBar";
import { api } from "../lib/tauri";
import type { ProjectSummary } from "../lib/types";

export function QuickResume({ project }: { project: ProjectSummary }) {
  const { t } = useTranslation();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
        {t("dashboard.quickResume")}
      </p>
      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
        {project.name}
      </h2>
      {project.last_summary && (
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          {project.last_summary}
        </p>
      )}
      <div className="mb-4">
        <ProgressBar percent={project.progress_percent} />
      </div>
      <button
        onClick={() => api.openInEditor(project.id)}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
      >
        {t("common.openEditor")}
      </button>
    </div>
  );
}
