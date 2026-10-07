import { NotificationOutboxStatus, VaultScanStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { internalBearerAuthorized } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const notificationStatuses = [
  NotificationOutboxStatus.PENDING,
  NotificationOutboxStatus.PROCESSING,
  NotificationOutboxStatus.DELIVERED,
  NotificationOutboxStatus.FAILED,
  NotificationOutboxStatus.DEAD_LETTER
] as const;

const scanStatuses = [
  VaultScanStatus.PENDING,
  VaultScanStatus.SCANNING,
  VaultScanStatus.CLEAN,
  VaultScanStatus.QUARANTINED,
  VaultScanStatus.FAILED
] as const;

const notificationChannels = ["IN_APP", "EMAIL", "OTHER"] as const;

function metricHeaders() {
  return {
    "cache-control": "no-store",
    "content-type": "text/plain; version=0.0.4; charset=utf-8",
    "x-content-type-options": "nosniff"
  };
}

function ageSeconds(value: Date | null | undefined, now: Date) {
  if (!value) return 0;
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / 1000));
}

function notificationChannel(value: string) {
  return value === "IN_APP" || value === "EMAIL" ? value : "OTHER";
}

export async function GET(request: Request) {
  if (!internalBearerAuthorized(request, "HRBP_METRICS_TOKEN")) {
    return new Response("unauthorized\n", { status: 401, headers: metricHeaders() });
  }

  const startedAt = Date.now();
  const now = new Date();

  try {
    const [
      notificationGroups,
      oldestNotification,
      scanGroups,
      oldestPendingScan,
      oldestScanningLock,
      dueScanJobs
    ] = await Promise.all([
      db.notificationOutbox.groupBy({
        by: ["channel", "status"],
        _count: { _all: true }
      }),
      db.notificationOutbox.findFirst({
        where: {
          status: {
            in: [NotificationOutboxStatus.PENDING, NotificationOutboxStatus.FAILED]
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { createdAt: true }
      }),
      db.documentVersion.groupBy({
        by: ["scanStatus"],
        _count: { _all: true }
      }),
      db.documentVersion.findFirst({
        where: {
          uploadedAt: { not: null },
          scanStatus: VaultScanStatus.PENDING
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { createdAt: true }
      }),
      db.documentVersion.findFirst({
        where: {
          scanStatus: VaultScanStatus.SCANNING,
          scanLockedAt: { not: null }
        },
        orderBy: [{ scanLockedAt: "asc" }, { id: "asc" }],
        select: { scanLockedAt: true }
      }),
      db.documentVersion.count({
        where: {
          uploadedAt: { not: null },
          scanStatus: VaultScanStatus.PENDING,
          scanNextAttemptAt: { lte: now }
        }
      })
    ]);

    const notificationCounts = new Map<string, number>();
    for (const channel of notificationChannels) {
      for (const status of notificationStatuses) {
        notificationCounts.set(`${channel}:${status}`, 0);
      }
    }
    for (const row of notificationGroups) {
      const channel = notificationChannel(row.channel);
      const key = `${channel}:${row.status}`;
      notificationCounts.set(key, (notificationCounts.get(key) ?? 0) + row._count._all);
    }

    const scanCounts = new Map<VaultScanStatus, number>();
    for (const status of scanStatuses) scanCounts.set(status, 0);
    for (const row of scanGroups) {
      scanCounts.set(row.scanStatus, row._count._all);
    }

    const lines = [
      "# HELP hrbp_operational_metrics_up Whether HRBP operational metrics were collected successfully.",
      "# TYPE hrbp_operational_metrics_up gauge",
      "hrbp_operational_metrics_up 1",
      "# HELP hrbp_notification_outbox_records Current notification outbox records by bounded channel and status.",
      "# TYPE hrbp_notification_outbox_records gauge"
    ];

    for (const channel of notificationChannels) {
      for (const status of notificationStatuses) {
        lines.push(
          `hrbp_notification_outbox_records{channel="${channel}",status="${status}"} ${notificationCounts.get(`${channel}:${status}`) ?? 0}`
        );
      }
    }

    lines.push(
      "# HELP hrbp_notification_outbox_oldest_actionable_age_seconds Age of the oldest pending or retryable notification record.",
      "# TYPE hrbp_notification_outbox_oldest_actionable_age_seconds gauge",
      `hrbp_notification_outbox_oldest_actionable_age_seconds ${ageSeconds(oldestNotification?.createdAt, now)}`,
      "# HELP hrbp_document_scan_records Current document-version records by malware scan status.",
      "# TYPE hrbp_document_scan_records gauge"
    );

    for (const status of scanStatuses) {
      lines.push(`hrbp_document_scan_records{status="${status}"} ${scanCounts.get(status) ?? 0}`);
    }

    lines.push(
      "# HELP hrbp_document_scan_due_jobs Uploaded document scan jobs currently eligible to be claimed.",
      "# TYPE hrbp_document_scan_due_jobs gauge",
      `hrbp_document_scan_due_jobs ${dueScanJobs}`,
      "# HELP hrbp_document_scan_oldest_pending_age_seconds Age of the oldest uploaded document still pending scanning.",
      "# TYPE hrbp_document_scan_oldest_pending_age_seconds gauge",
      `hrbp_document_scan_oldest_pending_age_seconds ${ageSeconds(oldestPendingScan?.createdAt, now)}`,
      "# HELP hrbp_document_scan_oldest_scanning_lock_age_seconds Age of the oldest active scanner lease.",
      "# TYPE hrbp_document_scan_oldest_scanning_lock_age_seconds gauge",
      `hrbp_document_scan_oldest_scanning_lock_age_seconds ${ageSeconds(oldestScanningLock?.scanLockedAt, now)}`,
      "# HELP hrbp_operational_metrics_scrape_duration_seconds Time spent collecting this metrics snapshot.",
      "# TYPE hrbp_operational_metrics_scrape_duration_seconds gauge",
      `hrbp_operational_metrics_scrape_duration_seconds ${((Date.now() - startedAt) / 1000).toFixed(3)}`
    );

    return new Response(`${lines.join("\n")}\n`, {
      status: 200,
      headers: metricHeaders()
    });
  } catch {
    console.error("[HRBP] Operational metrics collection failed.");
    return new Response(
      [
        "# HELP hrbp_operational_metrics_up Whether HRBP operational metrics were collected successfully.",
        "# TYPE hrbp_operational_metrics_up gauge",
        "hrbp_operational_metrics_up 0",
        ""
      ].join("\n"),
      { status: 503, headers: metricHeaders() }
    );
  }
}
