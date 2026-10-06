import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { localRepo } from "~/client/db/local-repo";
import { useAppStore } from "~/client/state/store/app-store";
import { useLive } from "~/client/hooks/use-live";
import { ConfirmButton } from "~/components/confirm-button";
import { Badge, Button, Card, EmptyState } from "~/components/ui";
import { toast } from "~/client/toast";
import {
  loadPreferences,
  savePreferences,
  type Preferences,
} from "~/client/preferences";
import { applyContrastPreference } from "~/client/theme";
import { playFeedback } from "~/client/feedback";
import { isCredentialExpired, remainingDays } from "~/client/auth/offline-auth";
import { formatDateTime, formatRelativeDateTime } from "~/shared/format";
import {
  Check,
  ChevronDown,
  Clock,
  Contrast,
  Copy,
  Database,
  Download,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  User,
  Vibrate,
  Volume2,
  VolumeX,
} from "lucide-react";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(1)} ${units[index]}`;
}

function ToggleSwitch({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`touch-target relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors duration-200 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand ${
        checked ? "border-brand bg-brand" : "border-line-strong bg-control"
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-6 w-6 transform rounded-full shadow-sm transition duration-200 ${
          checked ? "translate-x-6 bg-on-brand" : "translate-x-0.5 bg-fg-muted"
        }`}
      />
    </button>
  );
}

function SettingRow({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onChange(!checked);
        }
      }}
      className="touch-target flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-surface/40 p-3 transition hover:border-line-hover hover:bg-surface/80"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-raised text-fg-muted">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-fg">{title}</p>
          <p className="text-xs text-fg-subtle leading-relaxed">
            {description}
          </p>
        </div>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

function SettingsPage() {
  const online = useAppStore((state) => state.online);
  const downloadData = useAppStore((state) => state.downloadData);
  const pullProgress = useAppStore((state) => state.pullProgress);
  const lastPullAt = useAppStore((state) => state.lastPullAt);
  const refreshPurchases = useAppStore((state) => state.refreshPurchases);
  const logout = useAppStore((state) => state.logout);
  const user = useAppStore((state) => state.user);
  const credentials = useAppStore((state) => state.credentials);
  const sessionTtlDaysLeft = useAppStore((state) => state.sessionTtlDaysLeft);
  const refresh = useAppStore((state) => state.refresh);
  const deviceId = useAppStore((state) => state.deviceId);
  const now = new Date();

  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(
    null,
  );
  const [preferences, setPreferences] = useState<Preferences>(() =>
    loadPreferences(),
  );
  const [copied, setCopied] = useState(false);

  const counts = useLive(() => localRepo.masterCounts(), [], {});
  const sessionCount = useLive(() => localRepo.db.sessions.count(), [], 0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (typeof navigator === "undefined" || !navigator.storage?.estimate)
        return;
      const estimate = await navigator.storage.estimate();
      if (!cancelled) {
        setUsage({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [counts]);

  const handleDownload = async () => {
    const result = await downloadData();
    toast(result.ok ? "success" : "danger", result.message);
  };

  const handleRefreshPo = async () => {
    const result = await refreshPurchases();
    toast(result.ok ? "success" : "danger", result.message);
  };

  const handleCleanup = async () => {
    const removed = await localRepo.deleteSyncedSessions();
    await refresh();
    toast(
      "info",
      `${removed} sesi tersinkron dibersihkan. Data master dipertahankan.`,
    );
  };

  const handleCopyDeviceId = async () => {
    if (!deviceId) return;
    try {
      await navigator.clipboard.writeText(deviceId);
      setCopied(true);
      toast("success", "ID Perangkat berhasil disalin.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("warn", `ID Perangkat: ${deviceId}`);
    }
  };

  const updatePreferences = (patch: Partial<Preferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    savePreferences(next);
    applyContrastPreference();

    // Berikan feedback langsung saat mengaktifkan preferensi suara / getar
    if (patch.feedbackBeep === true) {
      playFeedback("success");
    }
    if (patch.feedbackVibrate === true) {
      playFeedback("success");
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-6">
      {/* 2. Sinkronisasi Data */}
      <Card
        title={
          <div className="flex items-center gap-2">
            <Database
              className="h-5 w-5 text-brand-bright"
              aria-hidden="true"
            />
            <span>Sinkronisasi Data</span>
          </div>
        }
        actions={
          <span
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              online
                ? "bg-ok-fill text-on-ok-fill"
                : "bg-danger-fill text-on-danger-fill"
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-2 w-2 rounded-full ${online ? "bg-ok-dot" : "bg-danger-dot"}`}
            />
            {online ? "Online" : "Offline"}
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          {/* Status info bar */}
          <div className="flex items-center justify-between gap-2 rounded-lg bg-surface/40 p-2.5 text-xs text-fg-subtle border border-line-soft">
            <div className="flex items-center gap-1.5 min-w-0">
              <Clock
                className="h-4 w-4 shrink-0 text-fg-muted"
                aria-hidden="true"
              />
              <span className="truncate">
                {lastPullAt
                  ? `Terakhir diunduh: ${formatRelativeDateTime(lastPullAt, now)}`
                  : "Belum pernah diunduh"}
              </span>
            </div>
            {lastPullAt ? (
              <span className="shrink-0 font-mono text-[11px] text-fg-muted hidden sm:inline">
                {formatDateTime(lastPullAt)}
              </span>
            ) : null}
          </div>

          {/* Download progress bar */}
          {pullProgress.running ? (
            <div className="rounded-xl border border-info bg-info-wash/40 p-3">
              <div className="flex items-center justify-between gap-2 text-sm font-semibold text-info-text">
                <span className="flex items-center gap-1.5">
                  <RefreshCw
                    className="h-4 w-4 animate-spin shrink-0"
                    aria-hidden="true"
                  />
                  Mengunduh: {pullProgress.kind}
                </span>
                <span className="tabular-nums font-mono">
                  {pullProgress.fetched}
                  {pullProgress.total ? ` / ${pullProgress.total}` : ""}
                </span>
              </div>
              {pullProgress.total ? (
                <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-control">
                  <div
                    className="h-full bg-brand transition-all duration-200"
                    style={{
                      width: `${Math.min(100, Math.round((pullProgress.fetched / pullProgress.total) * 100))}%`,
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Action buttons */}
          <div className="flex flex-col gap-2.5">
            {/* Refresh PO */}
            <div className="flex flex-col gap-1">
              <Button
                variant="secondary"
                className="flex items-center justify-center gap-2 w-full font-semibold"
                disabled={!online || pullProgress.running}
                onClick={() => void handleRefreshPo()}
              >
                <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Refresh PO</span>
              </Button>
              <p className="text-xs text-fg-subtle px-1">
                Perbarui daftar PO terbaru dari server tanpa mengunduh ulang
                master barang.
              </p>
            </div>

            {/* Unduh Ulang Master Data */}
            <div className="flex flex-col gap-1">
              <Button
                variant="primary"
                className="flex items-center justify-center gap-2 w-full font-semibold"
                disabled={!online || pullProgress.running}
                onClick={() => void handleDownload()}
              >
                <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {pullProgress.running
                    ? "Sedang Mengunduh…"
                    : "Unduh Ulang Data (PO & Master)"}
                </span>
              </Button>
              <p className="text-xs text-fg-subtle px-1">
                Unduh penuh seluruh data barang, barcode, unit, vendor, dan PO
                untuk kesiapan kerja offline.
              </p>
            </div>

            {/* Cleanup */}
            <div className="flex flex-col gap-1 pt-1 border-t border-line-soft">
              <ConfirmButton
                tone="danger"
                className="w-full touch-target rounded-lg font-semibold"
                label="Bersihkan Dokumen yang Sudah Masuk Sistem"
                confirmLabel="Tahan terus… data akan dibersihkan"
                onConfirm={() => void handleCleanup()}
              />
              <p className="text-xs text-fg-subtle px-1">
                Hapus dokumen sesi yang sudah tersinkron untuk mengosongkan
                memori. Data master tetap aman.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* 3. Tampilan & Umpan Balik */}
      <Card
        title={
          <div className="flex items-center gap-2">
            <Contrast
              className="h-5 w-5 text-brand-bright"
              aria-hidden="true"
            />
            <span>Tampilan & Umpan Balik</span>
          </div>
        }
      >
        <div className="flex flex-col gap-2.5">
          <SettingRow
            icon={Contrast}
            title="Kontras Tinggi"
            description="Tegaskan garis batas dan pekatkan permukaan untuk gudang atau dok bongkar yang sangat terang."
            checked={preferences.highContrast}
            onChange={(checked) => updatePreferences({ highContrast: checked })}
          />

          <SettingRow
            icon={preferences.feedbackBeep ? Volume2 : VolumeX}
            title="Bunyi Scanner"
            description="Konfirmasi suara beep saat barcode berhasil discan atau terjadi kesalahan."
            checked={preferences.feedbackBeep}
            onChange={(checked) => updatePreferences({ feedbackBeep: checked })}
          />

          <SettingRow
            icon={Vibrate}
            title="Getar Scanner"
            description="Umpan balik haptic getaran pada genggaman perangkat PDT saat pemindaian."
            checked={preferences.feedbackVibrate}
            onChange={(checked) =>
              updatePreferences({ feedbackVibrate: checked })
            }
          />
        </div>
      </Card>

      {/* 4. Ringkasan Data Lokal */}
      <Card
        title={
          <div className="flex items-center gap-2">
            <HardDrive
              className="h-5 w-5 text-brand-bright"
              aria-hidden="true"
            />
            <span>Ringkasan Data Lokal</span>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-line bg-surface/40 p-3">
            <p className="text-xs text-fg-subtle">PO Aktif</p>
            <p className="mt-1 text-xl font-bold  text-fg">
              {counts.purchases ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface/40 p-3">
            <p className="text-xs text-fg-subtle">Master Barang</p>
            <p className="mt-1 text-xl font-bold  text-fg">
              {counts.items ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface/40 p-3">
            <p className="text-xs text-fg-subtle">Sesi Tersimpan</p>
            <p className="mt-1 text-xl font-bold  text-fg">{sessionCount}</p>
          </div>
          <div className="rounded-xl border border-line bg-surface/40 p-3">
            <p className="text-xs text-fg-subtle">Penyimpanan</p>
            <p className="mt-1 text-xl font-bold  text-fg">
              {formatBytes(usage?.usage)}
            </p>
          </div>
        </div>
      </Card>

      {/* 5. Info & Diagnostik (Tim IT) */}
      <details className="group rounded-xl border border-line bg-surface/60 p-4 transition">
        <summary className="flex cursor-pointer items-center justify-between gap-2 text-base font-bold text-fg select-none">
          <div className="flex items-center gap-2">
            <ShieldCheck
              className="h-5 w-5 text-brand-bright"
              aria-hidden="true"
            />
            <span>Info</span>
          </div>
          <ChevronDown
            className="h-5 w-5 text-fg-subtle transition-transform duration-200 group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>

        <div className="mt-4 flex flex-col gap-4 border-t border-line-soft pt-3">
          {/* Data Master Terperinci */}
          <div>
            <p className="mb-1.5 text-sm font-semibold text-fg-muted">
              Rincian Master Database Lokal
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between rounded-lg border border-line-soft bg-surface/30 p-2 text-fg-muted">
                <span>PO</span>
                <span className="font-bold  text-fg">
                  {counts.purchases ?? 0}
                </span>
              </div>
              <div className="flex justify-between rounded-lg border border-line-soft bg-surface/30 p-2 text-fg-muted">
                <span>Item PO</span>
                <span className="font-bold  text-fg">
                  {counts.purchaseItems ?? 0}
                </span>
              </div>
              <div className="flex justify-between rounded-lg border border-line-soft bg-surface/30 p-2 text-fg-muted">
                <span>Master Barang</span>
                <span className="font-bold  text-fg">{counts.items ?? 0}</span>
              </div>
              <div className="flex justify-between rounded-lg border border-line-soft bg-surface/30 p-2 text-fg-muted">
                <span>Satuan (UOM)</span>
                <span className="font-bold  text-fg">{counts.units ?? 0}</span>
              </div>
              <div className="flex justify-between rounded-lg border border-line-soft bg-surface/30 p-2 text-fg-muted">
                <span>Vendor</span>
                <span className="font-bold  text-fg">
                  {counts.vendors ?? 0}
                </span>
              </div>
              <div className="flex justify-between rounded-lg border border-line-soft bg-surface/30 p-2 text-fg-muted">
                <span>Konversi Satuan</span>
                <span className="font-bold  text-fg">
                  {counts.vendorItems ?? 0}
                </span>
              </div>
            </div>
          </div>

          {/* Kredensial Offline */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-fg-muted">
                Kredensial Offline Ter-cache ({credentials.length})
              </p>
            </div>
            {credentials.length === 0 ? (
              <EmptyState>Belum ada kredensial tersimpan di perangkat ini.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-2">
                {credentials.map((credential) => {
                  const expired = isCredentialExpired(credential, now);
                  const days = remainingDays(credential, now);
                  return (
                    <li
                      key={credential.key}
                      className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface/40 p-2.5"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-fg truncate text-sm">
                          {credential.fullName}
                        </p>
                        <p className="text-xs text-fg-subtle truncate">
                          @{credential.loginId}
                        </p>
                      </div>
                      <Badge
                        tone={
                          expired ? "danger" : days <= 2 ? "warn" : "success"
                        }
                      >
                        {expired ? "Kedaluwarsa" : `${days} hari lagi`}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-xs text-fg-subtle leading-relaxed">
              Kredensial diamankan dengan WebCrypto salt hashing. Password teks asli tidak pernah disimpan di perangkat.
            </p>
          </div>
        </div>
      </details>

      {/* 1. Akun & Sesi Operator */}
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3 rounded-xl  bg-surface/40 ">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-wash text-lg font-bold text-brand-bright">
                {user?.fullName?.charAt(0)?.toUpperCase() ?? "U"}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-fg">
                  {user?.fullName ?? "Operator"}
                </p>
                <p className="truncate text-sm text-fg-subtle">
                  ID: {user?.loginId ?? "-"}
                </p>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1.5 shrink-0">
              {sessionTtlDaysLeft !== null ? (
                <Badge tone={sessionTtlDaysLeft <= 2 ? "warn" : "success"}>
                  Sesi: {sessionTtlDaysLeft} hari
                </Badge>
              ) : null}
            </div>
          </div>
          <div>
            {deviceId ? (
              <button
                type="button"
                onClick={() => void handleCopyDeviceId()}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs w-full! text-fg-subtle transition hover:bg-raised hover:text-fg"
                title="Klik untuk menyalin Device ID"
              >
                <Smartphone className="h-5 w-5" aria-hidden="true" />
                <span className="font-mono">{deviceId}</span>
                {copied ? (
                  <Check
                    className="h-5 w-5 text-ok-bright"
                    aria-hidden="true"
                  />
                ) : (
                  <Copy className="h-5 w-5" aria-hidden="true" />
                )}
              </button>
            ) : null}
          </div>

          <div className="pt-1">
            <ConfirmButton
              tone="danger"
              className="w-full touch-target rounded-lg font-semibold"
              label="Keluar dari Akun (Logout)"
              confirmLabel="Tahan terus untuk keluar…"
              onConfirm={() => void logout()}
            />
            <p className="mt-1.5 text-center text-xs text-fg-subtle">
              Data sesi dan pekerjaan offline tetap tersimpan di perangkat
              setelah logout.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
