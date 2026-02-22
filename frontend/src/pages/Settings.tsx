import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { ArrowLeft, RefreshCw } from "lucide-react";
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
      <div className="flex items-center justify-center h-screen" style={{ background: "var(--bg-app)" }}>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-8 py-6" style={{ background: "var(--bg-app)" }}>
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 transition-colors mb-6"
        style={{ fontSize: 13, color: "var(--text-secondary)" }}
        onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-primary)"}
        onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-secondary)"}
      >
        <ArrowLeft size={14} /> {t("settings.backToDashboard")}
      </Link>

      <h1
        className="font-semibold mb-6"
        style={{ fontSize: 20, color: "var(--text-primary)" }}
      >
        {t("settings.title")}
      </h1>

      <div className="max-w-lg space-y-3">
        {/* Language */}
        <SettingCard>
          <SettingLabel htmlFor="language-select">{t("settings.language")}</SettingLabel>
          <select
            id="language-select"
            value={i18n.language}
            onChange={(e) => {
              const val = e.target.value;
              i18n.changeLanguage(val);
              localStorage.setItem("seslog-language", val);
              localStorage.removeItem("ctx-lab-language");
            }}
            className="w-full rounded-md px-3 py-1.5 transition-colors focus:outline-none"
            style={{
              fontSize: 13,
              background: "var(--bg-app)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          >
            <option value="en">English</option>
            <option value="tr">Turkce</option>
          </select>
        </SettingCard>

        {/* Privacy Mode */}
        <SettingCard>
          <SettingLabel htmlFor="privacy-mode">{t("settings.privacyMode")}</SettingLabel>
          <select
            id="privacy-mode"
            value={config?.privacy_mode ?? "full"}
            onChange={(e) => handlePrivacyChange(e.target.value)}
            className="w-full rounded-md px-3 py-1.5 transition-colors focus:outline-none"
            style={{
              fontSize: 13,
              background: "var(--bg-app)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          >
            <option value="full">Full</option>
          </select>
        </SettingCard>

        {/* Checkpoint Interval */}
        <SettingCard>
          <SettingLabel htmlFor="checkpoint-interval">{t("settings.checkpointInterval")}</SettingLabel>
          <div className="flex items-center gap-3">
            <input
              id="checkpoint-interval"
              type="range"
              min={1}
              max={30}
              value={config?.checkpoint_interval_minutes ?? 10}
              onChange={(e) => handleIntervalChange(Number(e.target.value))}
              onMouseUp={handleIntervalCommit}
              onTouchEnd={handleIntervalCommit}
              className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer"
              style={{ accentColor: "var(--accent)" }}
            />
            <span
              className="font-mono tabular-nums text-right"
              style={{ fontSize: 13, color: "var(--text-secondary)", minWidth: 24 }}
            >
              {config?.checkpoint_interval_minutes ?? 10}
            </span>
          </div>
        </SettingCard>

        {/* Sanitize Secrets */}
        <SettingCard>
          <div className="flex items-center justify-between">
            <SettingLabel htmlFor="sanitize-secrets">{t("settings.sanitizeSecrets")}</SettingLabel>
            <button
              id="sanitize-secrets"
              role="switch"
              aria-checked={config?.sanitize_secrets ?? true}
              onClick={() => handleSanitizeChange(!(config?.sanitize_secrets ?? true))}
              className="relative inline-flex items-center rounded-full transition-colors"
              style={{
                width: 36,
                height: 20,
                background: config?.sanitize_secrets ? "var(--accent)" : "var(--border-default)",
              }}
            >
              <span
                className="inline-block rounded-full bg-white transition-transform"
                style={{
                  width: 14,
                  height: 14,
                  transform: config?.sanitize_secrets ? "translateX(18px)" : "translateX(2px)",
                }}
              />
            </button>
          </div>
        </SettingCard>

        {/* Theme */}
        <SettingCard>
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
              {t("settings.theme")}
            </span>
            <ThemeToggle />
          </div>
        </SettingCard>

        {/* Rebuild Cache */}
        <SettingCard>
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
              {t("settings.rebuildCache")}
            </span>
            <button
              onClick={handleRebuildCache}
              disabled={rebuilding}
              className="flex items-center gap-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "white",
                background: "var(--accent)",
                padding: "6px 12px",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--accent-hover)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "var(--accent)"}
            >
              <RefreshCw size={13} className={rebuilding ? "animate-spin" : ""} />
              {t("settings.rebuildCache")}
            </button>
          </div>
          {rebuildResult && (
            <p className="mt-2" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {rebuildResult}
            </p>
          )}
        </SettingCard>

        {/* Status messages */}
        {savedMessage && (
          <p style={{ fontSize: 12, color: "#22c55e" }}>{savedMessage}</p>
        )}
        {saving && (
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Saving...</p>
        )}
      </div>
    </div>
  );
}

function SettingCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg px-4 py-3"
      style={{ border: "1px solid var(--border-default)", background: "var(--bg-surface)" }}
    >
      {children}
    </div>
  );
}

function SettingLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block mb-1.5"
      style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}
    >
      {children}
    </label>
  );
}
