import i18n from "i18next";
import { initReactI18next } from "react-i18next";

i18n.use(initReactI18next).init({
  resources: {
    en: {
      translation: {
        "dashboard.title": "Seslog",
        "dashboard.quickResume": "Continue where you left off",
        "dashboard.projects": "Projects",
        "dashboard.noProjects":
          "No projects yet. Start a Claude Code session to create one.",
        "dashboard.rebuildCache": "Rebuild Cache",
        "project.roadmap": "Roadmap",
        "project.sessions": "Sessions",
        "project.decisions": "Decisions",
        "project.noRoadmap": "No roadmap yet",
        "project.roadmapHint":
          "Start a Claude Code session and ask for help creating a project roadmap.",
        "project.nextSteps": "Next Steps",
        "project.backToDashboard": "Back to Dashboard",
        "common.loading": "Loading...",
        "common.notFound": "Project not found",
        "settings.title": "Settings",
        "settings.language": "Language",
        "settings.privacyMode": "Privacy Mode",
        "settings.checkpointInterval": "Checkpoint Interval (minutes)",
        "settings.sanitizeSecrets": "Sanitize Secrets",
        "settings.theme": "Theme",
        "settings.rebuildCache": "Rebuild Cache",
        "settings.saved": "Settings saved",
        "settings.backToDashboard": "Back to Dashboard",
      },
    },
    tr: {
      translation: {
        "dashboard.title": "Seslog",
        "dashboard.quickResume": "Kaldiginiz yerden devam edin",
        "dashboard.projects": "Projeler",
        "dashboard.noProjects":
          "Henuz proje yok. Bir Claude Code oturumu baslatin.",
        "dashboard.rebuildCache": "Onbellegi Yenile",
        "project.roadmap": "Yol Haritasi",
        "project.sessions": "Oturumlar",
        "project.decisions": "Kararlar",
        "project.noRoadmap": "Henuz yol haritasi yok",
        "project.roadmapHint":
          "Bir Claude Code oturumu baslatin ve proje yol haritasi olusturmak icin yardim isteyin.",
        "project.nextSteps": "Sonraki Adimlar",
        "project.backToDashboard": "Panele Don",
        "common.loading": "Yukleniyor...",
        "common.notFound": "Proje bulunamadi",
        "settings.title": "Ayarlar",
        "settings.language": "Dil",
        "settings.privacyMode": "Gizlilik Modu",
        "settings.checkpointInterval": "Kontrol Noktasi Araligi (dakika)",
        "settings.sanitizeSecrets": "Sirlari Temizle",
        "settings.theme": "Tema",
        "settings.rebuildCache": "Onbellegi Yenile",
        "settings.saved": "Ayarlar kaydedildi",
        "settings.backToDashboard": "Panele Don",
      },
    },
  },
  lng: localStorage.getItem("seslog-language") || localStorage.getItem("ctx-lab-language") || "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
