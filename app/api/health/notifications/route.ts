import { smtpConfigurationStatus } from "@/lib/notification-email-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const smtp = smtpConfigurationStatus();
  const healthy = !smtp.enabled || smtp.configured;

  return Response.json({
    status: healthy ? "ok" : "error",
    email: {
      enabled: smtp.enabled,
      configured: smtp.configured,
      eventCount: smtp.events.length
    }
  }, {
    status: healthy ? 200 : 503,
    headers: { "cache-control": "no-store" }
  });
}
