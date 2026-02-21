import { useParams, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { api } from "../lib/tauri";
import { RoadmapView } from "../components/RoadmapView";
import { SessionTimeline } from "../components/SessionTimeline";
import type { ProjectDetail as ProjectDetailType } from "../lib/types";

export function ProjectDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ProjectDetailType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      api
        .getProjectDetail(id)
        .then(setDetail)
        .finally(() => setLoading(false));
    }
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-gray-500 dark:text-gray-400">{t("common.loading")}</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="p-6">
        <p className="text-gray-500 dark:text-gray-400">{t("common.notFound")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <Link
        to="/"
        className="flex items-center gap-1 text-blue-600 dark:text-blue-400 mb-4 hover:underline"
      >
        <ArrowLeft size={16} /> {t("project.backToDashboard")}
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        {detail.name}
      </h1>

      {detail.recent_sessions.length > 0 &&
        detail.recent_sessions[0].next_steps && (
          <div className="mb-6 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 p-4">
            <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">
              {t("project.nextSteps")}
            </h3>
            <p className="text-sm text-blue-700 dark:text-blue-400">
              {detail.recent_sessions[0].next_steps}
            </p>
          </div>
        )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h2 className="text-lg font-semibold mb-3 text-gray-700 dark:text-gray-300">
            {t("project.roadmap")}
          </h2>
          <RoadmapView roadmap={detail.roadmap} />
        </div>
        <div>
          <h2 className="text-lg font-semibold mb-3 text-gray-700 dark:text-gray-300">
            {t("project.sessions")}
          </h2>
          <SessionTimeline sessions={detail.recent_sessions} />
        </div>
      </div>
    </div>
  );
}
