import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronRight, Play } from "lucide-react";
import { localRepo } from "~/client/db/local-repo";
import { useLive } from "~/client/hooks/use-live";
import { useAppStore } from "~/client/state/store/app-store";
import { toast } from "~/client/toast";
import { SegmentedProgress } from "~/components/segmented-progress";
import { Badge, Button, Card, EmptyState, inputClass } from "~/components/ui";
import { PROGRESS_LABEL, type ProgressStatus } from "~/shared/constants";
import { formatDate } from "~/shared/format";
import { splitByOwner } from "~/shared/session-owner";

export const Route = createFileRoute("/pos/")({
  component: PosListPage,
});

function toneFor(
  progress: ProgressStatus,
): "neutral" | "info" | "success" | "danger" {
  if (progress === "FULL") return "success";
  if (progress === "OVER") return "danger";
  if (progress === "PARTIAL") return "info";
  return "neutral";
}

type PoFilter = "ALL" | "NONE" | "PARTIAL" | "DONE";

/** FULL and OVER are one filter: both mean "nothing left to receive on this PO". */
const PO_FILTERS: ReadonlyArray<{ id: PoFilter; label: string }> = [
  { id: "ALL", label: "Semua" },
  { id: "NONE", label: "Belum" },
  { id: "PARTIAL", label: "Sebagian" },
  { id: "DONE", label: "Selesai" },
];

function matchesFilter(progress: ProgressStatus, filter: PoFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "DONE") return progress === "FULL" || progress === "OVER";
  return progress === filter;
}

function PosListPage() {
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState<PoFilter>("ALL");
  const summaries = useLive(() => localRepo.listPurchaseSummaries(), [], []);
  const online = useAppStore((state) => state.online);
  const pullProgress = useAppStore((state) => state.pullProgress);
  const downloadData = useAppStore((state) => state.downloadData);
  const user = useAppStore((state) => state.user);
  const running = useLive(() => localRepo.runningSessions(), [], []);
  // `runningSessions()` is device-wide, and this banner is an invitation to press. It may only
  // ever point at a session this operator is allowed to continue — pressing a colleague's would
  // land on the ownership gate, which is a dead end reached from a green "continue" banner.
  const { mine: myRunning, others: otherRunning } = useMemo(
    () => splitByOwner(running, user?.userId ?? null),
    [running, user?.userId],
  );
  const activeSession = myRunning[0];

  const handleDownload = async () => {
    const result = await downloadData();
    toast(result.ok ? "success" : "danger", result.message);
  };

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const list = [...summaries].sort((a, b) => {
      const timeA = a.purchDate
        ? new Date(a.purchDate.replace(" ", "T")).getTime() || 0
        : 0;
      const timeB = b.purchDate
        ? new Date(b.purchDate.replace(" ", "T")).getTime() || 0
        : 0;
      if (timeB !== timeA) return timeB - timeA;
      return (b.number ?? "").localeCompare(a.number ?? "");
    });
    return list.filter((row) => {
      if (!matchesFilter(row.progress, filter)) return false;
      if (!needle) return true;
      return (
        (row.number ?? "").toLowerCase().includes(needle) ||
        row.vendorName.toLowerCase().includes(needle)
      );
    });
  }, [summaries, term, filter]);

  return (
    <div className="flex flex-col gap-3">
      {activeSession ? (
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId: activeSession.sessionId }}
          className="touch-target flex items-center gap-3 rounded-xl border border-brand bg-brand-wash/40 p-3"
        >
          <Play
            className="h-6 w-6 shrink-0 text-brand-soft"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <span className="block font-bold text-fg">Lanjutkan sesi berjalan</span>
            <span className="block truncate text-sm text-fg-muted">
              {activeSession.purchaseNumber ?? activeSession.purchaseId} ·{' '}
              {activeSession.vendorName ?? '-'}
            </span>
            {/* `runningSessions()` orders newest first (local-repo.ts), so this banner points at
                the operator's OWN most recently started session. Saying so matters once there is
                more than one: without it the banner looks like THE running session rather than
                one of several, and the others are only reachable from the Penerimaan list. */}
            {myRunning.length > 1 ? (
              <span className="block text-sm font-semibold text-warn-text">
                +{myRunning.length - 1} sesi milikmu juga berjalan — lihat di Penerimaan.
              </span>
            ) : null}
            {/* Separate line, separate wording: "mine, elsewhere" and "someone else's" are two
                different facts, and one combined count would read as work this operator can
                finish. */}
            {otherRunning.length > 0 ? (
              <span className="block text-sm text-fg-subtle">
                {otherRunning.length} sesi operator lain juga berjalan di perangkat ini.
              </span>
            ) : null}
          </span>
          <ChevronRight
            className="h-6 w-6 shrink-0 text-brand-soft"
            aria-hidden="true"
          />
        </Link>
      ) : null}

      {/* No banner of their own, but the device is holding somebody else's unfinished work. Said
          on this screen because this is where a new session starts: the qty of those sessions is
          already counted into the progress meters below, so an operator who does not know they
          exist will read those numbers as the server's. */}
      {!activeSession && otherRunning.length > 0 ? (
        <p className="rounded-xl border border-line bg-surface/60 p-3 text-sm text-fg-muted">
          {otherRunning.length} sesi operator lain masih berjalan di perangkat ini. Hanya
          pemiliknya yang bisa melanjutkan — lihat di Penerimaan.
        </p>
      ) : null}

      <Card>
        <input
          className={`${inputClass} w-full border-line-strong`}
          aria-label="Cari PO"
          placeholder="Cari nomor PO atau vendor…"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        <div
          role="group"
          aria-label="Saring menurut progres"
          className="mt-2 flex gap-1.5"
        >
          {PO_FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              className={`touch-target flex-1 rounded-full px-1 text-xs font-semibold transition sm:text-sm ${
                filter === option.id
                  ? "bg-brand text-on-brand"
                  : "bg-control text-fg hover:bg-control-off"
              }`}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Card>

      {summaries.length === 0 ? (
        <Card>
          <EmptyState>Belum ada data PO di perangkat ini.</EmptyState>
          <Button
            className="w-full"
            disabled={!online || pullProgress.running}
            onClick={() => void handleDownload()}
          >
            {pullProgress.running ? "Mengunduh…" : "Unduh data sekarang"}
          </Button>
          {online ? null : (
            <p className="mt-2 text-center text-sm text-fg-subtle">
              Sambungkan perangkat ke jaringan untuk mengunduh data.
            </p>
          )}
        </Card>
      ) : null}

      {summaries.length > 0 && filtered.length === 0 ? (
        <Card>
          <EmptyState>
            Tidak ada PO yang cocok dengan pencarian ini.
          </EmptyState>
        </Card>
      ) : null}

      {filtered.map((row) => (
        <Link
          key={row.purchaseId}
          to="/pos/$purchaseId"
          params={{ purchaseId: row.purchaseId }}
          className="block rounded-xl border border-line bg-surface/60 p-3 transition hover:border-line-hover"
        >
          <div className="flex  items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-lg font-bold text-fg">
                {row.number ?? row.purchaseId}
              </p>
              <p className="text-fg-muted">{row.vendorName}</p>
              <p className="text-sm text-fg-subtle">
                {formatDate(row.purchDate)}
              </p>
            </div>
            <Badge tone={toneFor(row.progress)}>
              <div className="whitespace-nowrap">{PROGRESS_LABEL[row.progress]}</div>
            </Badge>
          </div>

          <div className="mt-3">
            <SegmentedProgress
              ordered={row.orderedTotal}
              serverReceived={row.serverReceivedTotal}
              localPending={row.localPendingTotal}
            />
          </div>
        </Link>
      ))}
    </div>
  );
}
