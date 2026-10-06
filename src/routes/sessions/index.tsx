import { createFileRoute, Link } from "@tanstack/react-router";
import { localRepo } from "~/client/db/local-repo";
import { useLive } from "~/client/hooks/use-live";
import { Badge, Card, EmptyState } from "~/components/ui";
import { SESSION_STATUS_LABEL, type SessionStatus } from "~/shared/constants";
import { formatDateTime } from "~/shared/format";

export const Route = createFileRoute("/sessions/")({
  component: SessionsPage,
});

function toneFor(
  status: SessionStatus,
): "neutral" | "info" | "success" | "warn" | "danger" {
  switch (status) {
    case "SYNCED":
      return "success";
    case "FAILED":
      return "danger";
    case "REJECTED":
      return "danger";
    case "SYNCING":
      return "info";
    case "PENDING":
      return "warn";
    default:
      return "neutral";
  }
}

function SessionsPage() {
  const sessions = useLive(() => localRepo.listSessions(), [], []);

  return (
    <div className="flex flex-col gap-3">
      <Card title="Sesi Penerimaan">
        <p className="text-sm text-fg-subtle">
          Pantau status dan tindakan sesi pada daftar.
        </p>
      </Card>

      {sessions.length === 0 ? (
        <Card>
          <EmptyState>Belum ada sesi penerimaan.</EmptyState>
        </Card>
      ) : null}

      {sessions.map((session) => (
        <Link
          key={session.sessionId}
          to="/sessions/$sessionId"
          params={{ sessionId: session.sessionId }}
          className="block rounded-xl border border-line bg-surface/60 p-3 transition hover:border-line-hover"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-lg font-bold text-fg">
                {session.number ?? "Belum punya nomor"}
              </p>
              <p className="text-fg-muted">
                {session.purchaseNumber ?? session.purchaseId} •{" "}
                {session.vendorName ?? "-"}
              </p>
              <p className="text-sm text-fg-subtle">
                {session.syncedAt
                  ? `Masuk sistem ${formatDateTime(session.syncedAt)}`
                  : `Dibuat ${formatDateTime(session.createdAt)}`}
              </p>
              {session.lastError ? (
                <p className="text-sm text-danger-soft">{session.lastError}</p>
              ) : null}
            </div>
            <Badge tone={toneFor(session.status)}>
              <div className="whitespace-nowrap">
                {SESSION_STATUS_LABEL[session.status]}
              </div>
            </Badge>
          </div>
        </Link>
      ))}
    </div>
  );
}
