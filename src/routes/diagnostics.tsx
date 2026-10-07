import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Copy, FileDown, Filter, Inbox } from "lucide-react";
import { useLive } from "~/client/hooks/use-live";
import { toast } from "~/client/toast";
import type { DiagLevel } from "~/client/diagnostics/events";
import {
  buildDiagnosticsCsv,
  buildDiagnosticsSummary,
  diagnosticsFileName,
} from "~/client/diagnostics/csv";
import { copyText, downloadTextFile } from "~/client/diagnostics/download";
import {
  EMPTY_DIAGNOSTICS,
  clearDiagnosticsLog,
  collectDiagnosticsExport,
  readDiagnostics,
} from "~/client/diagnostics/read";
import { AppBar } from "~/components/app-bar";
import { ConfirmButton } from "~/components/confirm-button";
import { Badge, Button, Card, EmptyState } from "~/components/ui";
import { SESSION_STATUS, SESSION_STATUS_LABEL } from "~/shared/constants";
import { formatDateTime } from "~/shared/format";

export const Route = createFileRoute("/diagnostics")({
  component: DiagnosticsPage,
});

/**
 * Entries rendered per page.
 *
 * The ring buffer holds 2000, and rendering all of them is what turns this screen into a hang on a
 * low-end PDT — which reads as a broken app, not as a long list. The operator is never the one
 * scrolling here anyway: this screen gets exported, not browsed.
 */
const PAGE_SIZE = 200;

const LEVEL_TONE: Record<DiagLevel, "neutral" | "warn" | "danger"> = {
  info: "neutral",
  warn: "warn",
  error: "danger",
};

function DiagnosticsPage() {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [busy, setBusy] = useState(false);

  const { snapshot, entries } = useLive(
    () => readDiagnostics({ limit, onlyProblems }),
    [limit, onlyProblems],
    EMPTY_DIAGNOSTICS,
  );

  const handleExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const payload = await collectDiagnosticsExport();
      const fileName = diagnosticsFileName(
        payload.snapshot.deviceId,
        new Date(),
      );
      if (downloadTextFile(fileName, buildDiagnosticsCsv(payload))) {
        toast(
          "success",
          `Berkas ${fileName} dibuat. Cek folder Download perangkat.`,
        );
        return;
      }
      // The download was swallowed by the WebView. Falling back to the clipboard here is the
      // difference between "tombolnya tidak berfungsi" and a log the IT team can actually read.
      if (await copyText(buildDiagnosticsSummary(payload))) {
        toast(
          "warn",
          "Unduhan tidak didukung perangkat ini. Ringkasan sudah disalin — tempel ke chat tim IT.",
        );
        return;
      }
      toast("danger", "Gagal mengekspor log di perangkat ini.");
    } catch {
      // Collecting the export is itself a Dexie read, and the device whose log is being asked for
      // is the one most likely to fail it: quota full, or IndexedDB unavailable in the WebView.
      // Without this catch the rejection is silent — no toast, `busy` back to false, the button
      // looking untouched — and it ends up in `unhandledrejection`, which writes it to the very
      // log that could not be read. The clipboard fallback below is never reached either, because
      // the throw happens before it.
      toast("danger", "Gagal membaca log perangkat ini. Laporkan ke tim IT.");
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const payload = await collectDiagnosticsExport();
      const copied = await copyText(buildDiagnosticsSummary(payload));
      toast(
        copied ? "success" : "danger",
        copied
          ? "Ringkasan diagnostik disalin."
          : "Perangkat ini tidak mengizinkan penyalinan.",
      );
    } catch {
      // Same reason as in handleExport: the read can fail on exactly the device being diagnosed.
      toast("danger", "Gagal membaca log perangkat ini. Laporkan ke tim IT.");
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const removed = await clearDiagnosticsLog();
      setLimit(PAGE_SIZE);
      toast("info", `${removed} entri log dihapus dari perangkat ini.`);
    } catch {
      // The operator held a destructive button for a second and a half; saying nothing would
      // leave them unable to tell whether the log is gone or still there.
      toast("danger", "Gagal menghapus log di perangkat ini.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-6">
      <AppBar
        title="Diagnostik"
        backTo="/settings"
        backLabel="Kembali ke Pengaturan"
      />

      <Card
        title={
          <span className="flex items-center gap-2">
            <Inbox className="h-5 w-5 text-brand-bright" aria-hidden="true" />
            <span>Antrean &amp; Sinkronisasi</span>
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            {Object.values(SESSION_STATUS).map((status) => (
              <div
                key={status}
                className="rounded-lg border border-line-soft bg-surface/40 p-2"
              >
                <p className="text-[11px] text-fg-subtle">
                  {SESSION_STATUS_LABEL[status]}
                </p>
                <p className="mt-0.5 text-lg font-bold  text-fg">
                  {snapshot.statusCounts[status] ?? 0}
                </p>
              </div>
            ))}
          </div>

          <dl className="flex flex-col gap-1 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-fg-subtle">Kirim terakhir</dt>
              <dd className="font-mono text-fg-muted">
                {formatDateTime(snapshot.lastPushAt)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-fg-subtle">Unduh terakhir</dt>
              <dd className="font-mono text-fg-muted">
                {formatDateTime(snapshot.lastPullAt)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-fg-subtle">ID Perangkat</dt>
              <dd className="font-mono text-fg-muted">
                {snapshot.deviceId ?? "-"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-fg-subtle">Versi</dt>
              <dd className="font-mono text-fg-muted">{snapshot.appVersion}</dd>
            </div>
          </dl>

          {snapshot.purchasesStale ? (
            <Badge tone="warn">
              Daftar PO belum disegarkan — akan dicoba lagi saat kirim
            </Badge>
          ) : null}

          <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
            <Button
              className="flex w-full items-center justify-center gap-2"
              disabled={busy}
              onClick={() => void handleExport()}
            >
              <FileDown className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{busy ? "Menyiapkan…" : "Ekspor CSV"}</span>
            </Button>
            <Button
              variant="secondary"
              className="flex w-full items-center justify-center gap-2"
              disabled={busy}
              onClick={() => void handleCopy()}
            >
              <Copy className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Salin Ringkasan</span>
            </Button>
            <ConfirmButton
              tone="danger"
              // Locked while an export is collecting: wiping the log halfway through
              // `collectDiagnosticsExport()` produces a half-empty CSV with nothing saying so, and
              // a file that misleads the IT team is worse than no file.
              disabled={busy}
              className="w-full"
              label="Hapus Log"
              confirmLabel="Tahan terus… log akan dihapus"
              onConfirm={() => void handleClear()}
            />
            <p className="text-xs text-fg-subtle">
              Ekspor dan hapus hanya menyentuh log diagnostik perangkat ini.
              Dokumen penerimaan, antrean kirim, dan data master tidak
              terpengaruh.
            </p>
          </div>
        </div>
      </Card>

      <Card
        title={
          <span className="flex items-center gap-2">
            <span>Log</span>
          </span>
        }
        actions={
          <Button
            // A toggle button, so the LABEL stays still and `aria-pressed` carries the state. A
            // label that flips between "Semua" and "Hanya warn & error" reads as two different
            // buttons to a screen reader and as "what does it do now?" to everyone else.
            variant={onlyProblems ? "primary" : "secondary"}
            aria-pressed={onlyProblems}
            className="px-3 py-2 text-xs"
            onClick={() => {
              // The page size resets with the filter: keeping an offset from the other list would
              // show "Muat 200 lagi" under a list that already has everything.
              setOnlyProblems((previous) => !previous);
              setLimit(PAGE_SIZE);
            }}
          >
            Hanya warn &amp; error
          </Button>
        }
      >
        {entries.length === 0 ? (
          <EmptyState>
            {onlyProblems
              ? "Tidak ada entri warn atau error."
              : "Belum ada entri log."}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <li
                key={entry.id ?? `${entry.at}-${entry.message}`}
                className="rounded-lg border border-line-soft bg-surface/40 p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={LEVEL_TONE[entry.level]}>{entry.level}</Badge>
                  <span className="font-mono text-[11px] text-fg-subtle">
                    {formatDateTime(entry.at)}
                  </span>
                </div>
                <p className="mt-1 text-xs font-semibold text-fg-muted">
                  {entry.category ?? "-"} / {entry.event ?? "-"}
                </p>
                <p className="mt-0.5 text-sm text-fg">{entry.message}</p>
                {entry.sessionId ? (
                  <p className="mt-0.5 font-mono text-[11px] text-fg-subtle">
                    sesi {entry.sessionId}
                  </p>
                ) : null}
                {entry.detail ? (
                  <p className="mt-0.5 break-all font-mono text-[11px] text-fg-subtle">
                    {JSON.stringify(entry.detail)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {entries.length >= limit ? (
          <div className="mt-3">
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setLimit((previous) => previous + PAGE_SIZE)}
            >
              Muat {PAGE_SIZE} lagi
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
