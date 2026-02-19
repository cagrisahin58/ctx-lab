import i18n from "i18next";
import { initReactI18next } from "react-i18next";

i18n.use(initReactI18next).init({
  resources: {
    en: {
      translation: {
        "dashboard.title": "ctx-lab",
        "dashboard.quickResume": "Continue where you left off",
        "dashboard.projects": "Projects",
        "dashboard.noProjects":
          "No projects yet. Start a Claude Code session to create one.",
        "project.roadmap": "Roadmap",
        "project.sessions": "Sessions",
        "project.decisions": "Decisions",
        "project.backToDashboard": "Back to Dashboard",
        "common.loading": "Loading...",
        "common.openEditor": "Open in Editor",
        "common.notFound": "Project not found",
        "settings.title": "Settings",
        "settings.privacyMode": "Privacy Mode",
        "settings.checkpointInterval": "Checkpoint Interval (minutes)",
        "settings.sanitizeSecrets": "Sanitize Secrets",
        "settings.theme": "Theme",
        "settings.rebuildCache": "Rebuild Cache",
        "settings.saved": "Settings saved",
        "settings.backToDashboard": "Back to Dashboard",
      },
    },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
