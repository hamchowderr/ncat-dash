import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

// This provider is intentionally not global: only the purpose-written logs below are
// exported, leaving existing application logger outputs unchanged.
export const posthogLoggerProvider =
  token && host
    ? new LoggerProvider({
        resource: resourceFromAttributes({ "service.name": "takewon-web" }),
        processors: [
          new BatchLogRecordProcessor({
            exporter: new OTLPLogExporter({
              url: `${host.replace(/\/$/, "")}/i/v1/logs`,
              timeoutMillis: 2_000,
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            }),
          }),
        ],
      })
    : undefined;

const posthogLogger = posthogLoggerProvider?.getLogger("takewon.posthog");

export function emitPostHogLog(body: string, attributes: Record<string, string> = {}) {
  posthogLogger?.emit({
    body,
    severityNumber: SeverityNumber.INFO,
    attributes,
  });
}

export async function flushPostHogLogs() {
  await posthogLoggerProvider?.forceFlush().catch(() => {});
}

/**
 * Runs once when the web server starts. It tells the agent chat's proxy routes who is
 * asking: the signed-in user, so each person gets their own conversations, and never
 * someone else's.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (!posthogLoggerProvider) {
    if (process.env.NODE_ENV !== "production") {
      const missingVariable = token
        ? "NEXT_PUBLIC_POSTHOG_HOST"
        : "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN";
      console.warn(
        `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
      );
    }
  } else {
    emitPostHogLog("PostHog OTLP log exporter configured", { runtime: "nodejs" });
  }

  const { configureChatKitProxy } = await import("@/lib/mastra-proxy");
  const { agentUserFor } = await import("@/lib/agent-session");
  configureChatKitProxy({ getUserId: agentUserFor });
}
