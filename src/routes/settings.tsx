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
import { isCredentialExpired, remainingDays } from "~/client/auth/offline-auth";
import { formatDateTime, formatRelativeDateTime } from "~/shared/format";

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

function SettingsPage() {
  const online = useAppStore((state) => state.online);
  const downloadData = useAppStore((state) => state.downloadData);
  const pullProgress = useAppStore((state) => state.pullProgress);
  const lastPullAt = useAppStore((state) => state.lastPullAt);
  const refreshPurchases = useAppStore((state) => state.refreshPurchases);
  const logout = useAppStore((state) => state.logout);
  const credentials = useAppStore((state) => state.credentials);
  const refresh = useAppStore((state) => state.refresh);
  const deviceId = useAppStore((state) => state.deviceId);
  const now = new Date();
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(
    null,
  );
  const [preferences, setPreferences] = useState<Preferences>(() =>
    loadPreferences(),
  );

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

  const updatePreferences = (patch: Partial<Preferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    savePreferences(next);
    // The contrast layer lives on <html>, outside React's tree: re-apply it right away.
    applyContrastPreference();
  };

  return (
    <div className="flex flex-col gap-3">
      <Card title="Sinkronisasi Data">
        <div className="flex flex-col gap-2">
          <Button
            disabled={!online || pullProgress.running}
            onClick={() => void handleDownload()}
          >
            {pullProgress.running
              ? "Mengunduh…"
              : "Unduh Ulang Data (PO & Master)"}
          </Button>
          {pullProgress.running ? (
            <p className="text-sm text-fg-subtle">
              {pullProgress.kind}: {pullProgress.fetched}
              {pullProgress.total ? ` / ${pullProgress.total}` : ""}
            </p>
          ) : null}
          <Button
            variant="secondary"
            disabled={!online}
            onClick={() => void handleRefreshPo()}
          >
            Refresh PO
          </Button>
          <ConfirmButton
            tone="danger"
            className="w-full"
            label="Bersihkan dokumen yang sudah masuk sistem"
            confirmLabel="Tahan terus… data akan dibersihkan"
            onConfirm={() => void handleCleanup()}
          />
        </div>
        <p
          className="mt-2 text-xs text-fg-subtle"
          title={
            lastPullAt
              ? `Waktu tepat: ${formatDateTime(lastPullAt)}`
              : undefined
          }
        >
          {lastPullAt
            ? `Terakhir diunduh: ${formatRelativeDateTime(lastPullAt, now)}`
            : "Belum pernah diunduh"}
        </p>
      </Card>

      <Card title="Tampilan & Umpan Balik">
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-1 text-sm font-semibold text-fg-muted">
              Tampilan
            </p>
            <Button
              variant={preferences.highContrast ? "primary" : "secondary"}
              className="w-full"
              aria-pressed={preferences.highContrast}
              onClick={() =>
                updatePreferences({ highContrast: !preferences.highContrast })
              }
            >
              Kontras tinggi: {preferences.highContrast ? "Aktif" : "Mati"}
            </Button>
            <p className="mt-1 text-xs text-fg-subtle">
              Untuk gudang atau dok bongkar yang terang. Permukaan dibuat pekat
              dan garis batas dipertegas.
            </p>
          </div>
          <div>
            <p className="mb-1 text-sm font-semibold text-fg-muted">
              Umpan balik scan
            </p>
            <div className="flex gap-2">
              <Button
                variant={preferences.feedbackBeep ? "primary" : "secondary"}
                className="flex-1"
                aria-pressed={preferences.feedbackBeep}
                onClick={() =>
                  updatePreferences({ feedbackBeep: !preferences.feedbackBeep })
                }
              >
                Bunyi: {preferences.feedbackBeep ? "Aktif" : "Mati"}
              </Button>
              <Button
                variant={preferences.feedbackVibrate ? "primary" : "secondary"}
                className="flex-1"
                aria-pressed={preferences.feedbackVibrate}
                onClick={() =>
                  updatePreferences({
                    feedbackVibrate: !preferences.feedbackVibrate,
                  })
                }
              >
                Getar: {preferences.feedbackVibrate ? "Aktif" : "Mati"}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Akun">
        <Button
          variant="danger"
          className="w-full"
          onClick={() => void logout()}
        >
          Logout
        </Button>
      </Card>

      <details className="rounded-xl border border-line bg-surface/60 p-4">
        <summary className="cursor-pointer text-base font-bold text-fg">
          Info & Diagnostik (untuk tim IT)
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold text-fg-muted">
              Data lokal
            </p>
            <dl className="grid grid-cols-2 gap-2 text-sm text-fg-muted">
              <dt>PO</dt>
              <dd>{counts.purchases ?? 0}</dd>
              <dt>Item PO</dt>
              <dd>{counts.purchaseItems ?? 0}</dd>
              <dt>Master barang</dt>
              <dd>{counts.items ?? 0}</dd>
              <dt>Satuan</dt>
              <dd>{counts.units ?? 0}</dd>
              <dt>Vendor</dt>
              <dd>{counts.vendors ?? 0}</dd>
              <dt>Vendor item</dt>
              <dd>{counts.vendorItems ?? 0}</dd>
              <dt>Sesi tersimpan</dt>
              <dd>{sessionCount}</dd>
              <dt>Pemakaian penyimpanan</dt>
              <dd>{formatBytes(usage?.usage)}</dd>
            </dl>
            <p className="mt-1 break-all text-xs text-fg-subtle">
              Device ID: {deviceId ?? "-"}
            </p>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-fg-muted">
              Kredensial offline (per perangkat)
            </p>
            {credentials.length === 0 ? (
              <EmptyState>Belum ada kredensial tersimpan.</EmptyState>
            ) : (
              <ul className="flex flex-col divide-y divide-line-soft">
                {credentials.map((credential) => {
                  const expired = isCredentialExpired(credential, now);
                  const days = remainingDays(credential, now);
                  return (
                    <li
                      key={credential.key}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <div>
                        <p className="font-semibold text-fg">
                          {credential.fullName}
                        </p>
                        <p className="text-sm text-fg-subtle">
                          {credential.loginId}
                        </p>
                      </div>
                      <Badge
                        tone={
                          expired ? "danger" : days <= 2 ? "warn" : "success"
                        }
                      >
                        {expired ? "Kedaluwarsa" : `${days} hari`}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-xs text-fg-subtle">
              Password tidak disimpan sebagai teks biasa — hanya hash bersalt.
              Perubahan kredensial di pusat akan dicabut pada sinkronisasi
              berikutnya.
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}
