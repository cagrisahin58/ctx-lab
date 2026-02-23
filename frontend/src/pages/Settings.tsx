import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import i18n from "../i18n";
import { api } from "../lib/tauri";
import { ThemeToggle } from "../components/ThemeToggle";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Switch } from "../components/ui/switch";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { Skeleton } from "../components/ui/skeleton";
import type { AppConfig } from "../lib/types";

/* ── Loading skeleton ── */

function SettingsSkeleton() {
  return (
    <div className="max-w-lg mx-auto px-8 py-6 space-y-4">
      <Skeleton className="h-7 w-32 mb-6" />
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-24 w-full rounded-lg" />
      ))}
    </div>
  );
}

/* ── Form row layout ── */

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[hsl(var(--foreground))]">{label}</p>
        {description && (
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{description}</p>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

/* ── Main component ── */

export function Settings() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(setConfig)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (updated: AppConfig) => {
    try {
      await api.updateSettings(updated);
      toast.success(t("settings.saved"));
    } catch (err) {
      toast.error(String(err));
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

  const handleSanitizeChange = (checked: boolean) => {
    if (!config) return;
    const updated = { ...config, sanitize_secrets: checked };
    setConfig(updated);
    handleSave(updated);
  };

  const handleRebuildCache = async () => {
    setRebuilding(true);
    try {
      const result = await api.rebuildCache();
      if (typeof result === "string") {
        toast.success(result);
      } else {
        toast.success(
          `Added: ${result.added}, Removed: ${result.removed}, Updated: ${result.updated}`
        );
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setRebuilding(false);
    }
  };

  if (loading) {
    return <SettingsSkeleton />;
  }

  return (
    <div className="max-w-lg mx-auto px-8 py-6">
      <h1 className="text-2xl font-semibold text-[hsl(var(--foreground))] mb-6">
        {t("settings.title")}
      </h1>

      <div className="space-y-4">
        {/* General */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">General</CardTitle>
            <CardDescription>Language and appearance preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Language */}
            <SettingRow label={t("settings.language")}>
              <select
                value={i18n.language}
                onChange={(e) => {
                  const val = e.target.value;
                  i18n.changeLanguage(val);
                  localStorage.setItem("seslog-language", val);
                  localStorage.removeItem("ctx-lab-language");
                }}
                className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              >
                <option value="en">English</option>
                <option value="tr">Turkce</option>
              </select>
            </SettingRow>

            <Separator />

            {/* Theme */}
            <SettingRow label={t("settings.theme")}>
              <ThemeToggle />
            </SettingRow>
          </CardContent>
        </Card>

        {/* Privacy & Data */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Privacy & Data</CardTitle>
            <CardDescription>Control how your data is processed</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Privacy Mode */}
            <SettingRow
              label={t("settings.privacyMode")}
              description="Only 'Full' mode is available in v1"
            >
              <select
                value={config?.privacy_mode ?? "full"}
                onChange={(e) => handlePrivacyChange(e.target.value)}
                className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              >
                <option value="full">Full</option>
              </select>
            </SettingRow>

            <Separator />

            {/* Sanitize Secrets */}
            <SettingRow
              label={t("settings.sanitizeSecrets")}
              description="Redact secrets from transcripts before storage"
            >
              <Switch
                checked={config?.sanitize_secrets ?? true}
                onCheckedChange={handleSanitizeChange}
              />
            </SettingRow>
          </CardContent>
        </Card>

        {/* Performance */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Performance</CardTitle>
            <CardDescription>Tuning and checkpoint configuration</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingRow label={t("settings.checkpointInterval")}>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={30}
                  value={config?.checkpoint_interval_minutes ?? 10}
                  onChange={(e) => handleIntervalChange(Number(e.target.value))}
                  onMouseUp={handleIntervalCommit}
                  onTouchEnd={handleIntervalCommit}
                  className="w-32 h-1.5 rounded-lg appearance-none cursor-pointer"
                  style={{ accentColor: "hsl(var(--primary))" }}
                />
                <span className="font-mono tabular-nums text-sm text-[hsl(var(--muted-foreground))] w-6 text-right">
                  {config?.checkpoint_interval_minutes ?? 10}
                </span>
              </div>
            </SettingRow>
          </CardContent>
        </Card>

        {/* Maintenance */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Maintenance</CardTitle>
            <CardDescription>Cache and data management</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingRow
              label={t("settings.rebuildCache")}
              description="Re-scan all sessions and rebuild the project cache"
            >
              <Button
                variant="default"
                size="sm"
                onClick={handleRebuildCache}
                disabled={rebuilding}
              >
                <RefreshCw size={14} className={rebuilding ? "animate-spin mr-1.5" : "mr-1.5"} />
                {t("settings.rebuildCache")}
              </Button>
            </SettingRow>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
