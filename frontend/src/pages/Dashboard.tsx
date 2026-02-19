import { useTranslation } from "react-i18next";
import { useProjects } from "../hooks/useProjects";
import { ProjectCard } from "../components/ProjectCard";
import { QuickResume } from "../components/QuickResume";
import { ThemeToggle } from "../components/ThemeToggle";

export function Dashboard() {
  const { t } = useTranslation();
  const { projects, loading } = useProjects();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-gray-500 dark:text-gray-400">{t("common.loading")}</p>
      </div>
    );
  }

  const active = projects.filter((p) => p.status === "active");
  const lastProject = active[0]; // already sorted by last_session_at DESC from backend

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {t("dashboard.title")}
        </h1>
        <ThemeToggle />
      </header>
      {lastProject && <QuickResume project={lastProject} />}
      <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mt-8 mb-4">
        {t("dashboard.projects")}
      </h2>
      {active.length === 0 ? (
        <p className="text-gray-500">{t("dashboard.noProjects")}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {active.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}
