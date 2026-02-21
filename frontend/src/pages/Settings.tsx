import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { ArrowLeft, Settings as SettingsIcon, RefreshCw } from "lucide-react";
import { api } from "../lib/tauri";
import { ThemeToggle } from "../components/ThemeToggle";
import type { AppConfig } from "../lib/types";

export function Settings() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [rebuildResult, setRebuildResult] = useState("");
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(setConfig)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (updated: AppConfig) => {
    setSaving(true);
    setSavedMessage("");
    try {
      await api.updateSettings(updated);
      setSavedMessage(t("settings.saved"));
      setTimeout(() => setSavedMessage(""), 3000);
    } catch (err) {
      setSavedMessage(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handlePrivacyChange = (value: string) => {
    if (!config) return;
    const updated = { ...config, privacy_mode: value };
    setConfig(updated);
    handleSave(updated);
  };

  const handleIntervalChange = (value: number) => {
    if (!config) return;
    const updated = { ...config, checkpoint_interval_minutes: value };
    setConfig(updated);
  };

  const handleIntervalCommit = () => {
    if (!config) return;
    handleSave(config);
  };

  const handleSanitizeChange = (value: boolean) => {
    if (!config) return;
    const updated = { ...config, sanitize_secrets: value };
    setConfig(updated);
    handleSave(updated);
  };

  const handleRebuildCache = async () => {
    setRebuilding(true);
    setRebuildResult("");
    try {
      const result = await api.rebuildCache();
      if (typeof result === "string") {
        setRebuildResult(result);
      } else {
        setRebuildResult(
          `Added: ${result.added}, Removed: ${result.removed}, Updated: ${result.updated}`
        );
      }
    } catch (err) {
      setRebuildResult(String(err));
    } finally {
      setRebuilding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-gray-500 dark:text-gray-400">
          {t("common.loading")}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <Link
        to="/"
        className="flex items-center gap-1 text-blue-600 dark:text-blue-400 mb-4 hover:underline"
      >
        <ArrowLeft size={16} /> {t("settings.backToDashboard")}
      </Link>

      <header className="flex items-center gap-2 mb-8">
        <SettingsIcon size={24} className="text-gray-700 dark:text-gray-300" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {t("settings.title")}
        </h1>
      </header>

      <div className="max-w-lg space-y-6">
        {/* Language */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
          <label
            htmlFor="language-select"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            {t("settings.language")}
          </label>
          <select
            id="language-select"
            value={i18n.language}
            onChange={(e) => {
              const val = e.target.value;
              i18n.changeLanguage(val);
              localStorage.setItem("ctx-lab-language", val);
            }}
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="en">English</option>
            <option value="tr">Turkce</option>
          </select>
        </div>

        {/* Privacy Mode */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
          <label
            htmlFor="privacy-mode"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            {t("settings.privacyMode")}
          </label>
          <select
            id="privacy-mode"
            value={config?.privacy_mode ?? "full"}
            onChange={(e) => handlePrivacyChange(e.target.value)}
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="full">Full</option>
          </select>
        </div>

        {/* Checkpoint Interval */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
          <label
            htmlFor="checkpoint-interval"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            {t("settings.checkpointInterval")}
          </label>
          <div className="flex items-center gap-4">
            <input
              id="checkpoint-interval"
              type="range"
              min={1}
              max={30}
              value={config?.checkpoint_interval_minutes ?? 10}
              onChange={(e) => handleIntervalChange(Number(e.target.value))}
              onMouseUp={handleIntervalCommit}
              onTouchEnd={handleIntervalCommit}
              className="flex-1 h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <span className="text-sm font-mono text-gray-700 dark:text-gray-300 min-w-[3ch] text-right">
              {config?.checkpoint_interval_minutes ?? 10}
            </span>
          </div>
        </div>

        {/* Sanitize Secrets */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <label
              htmlFor="sanitize-secrets"
              className="text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("settings.sanitizeSecrets")}
            </label>
            <button
              id="sanitize-secrets"
              role="switch"
              aria-checked={config?.sanitize_secrets ?? true}
              onClick={() =>
                handleSanitizeChange(!(config?.sanitize_secrets ?? true))
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                config?.sanitize_secrets
                  ? "bg-blue-500"
                  : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  config?.sanitize_secrets ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Theme */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("settings.theme")}
            </span>
            <ThemeToggle />
          </div>
        </div>

        {/* Rebuild Cache */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("settings.rebuildCache")}
            </span>
            <button
              onClick={handleRebuildCache}
              disabled={rebuilding}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw
                size={16}
                className={rebuilding ? "animate-spin" : ""}
              />
              {t("settings.rebuildCache")}
            </button>
          </div>
          {rebuildResult && (
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {rebuildResult}
            </p>
          )}
        </div>

        {/* Save confirmation */}
        {savedMessage && (
          <p className="text-sm text-green-600 dark:text-green-400">
            {savedMessage}
          </p>
        )}
        {saving && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Saving...
          </p>
        )}
      </div>
    </div>
  );
}
