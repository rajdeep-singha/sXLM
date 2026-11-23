import { config } from "../config/index.js";
import type { Finding } from "./checks.js";

export type Status = "firing" | "reminder" | "resolved" | "test";

export interface Delivery {
  destination: "slack" | "webhook";
  ok: boolean;
  status?: number;
  error?: string;
}

const LABEL: Record<Status, string> = {
  firing: "ALERT",
  reminder: "STILL ACTIVE",
  resolved: "RESOLVED",
  test: "TEST",
};

export function formatSlack(f: Finding, status: Status): string {
  const icon = status === "resolved" ? ":white_check_mark:" : f.severity === "critical" ? ":rotating_light:" : ":warning:";
  return `${icon} *[${LABEL[status]}] ${f.name}* (${f.severity})\n${f.message}`;
}

/**
 * Send one alert to every configured destination: Slack (`SLACK_WEBHOOK_URL`)
 * as text, and the generic webhook (`ALERT_WEBHOOK_URL`, falling back to
 * `GOVERNANCE_WEBHOOK_URL`) as JSON.
 */
export async function deliver(
  f: Finding,
  status: Status,
  destinations = {
    slack: config.webhooks.slackUrl,
    webhook: config.webhooks.alertUrl,
  }
): Promise<Delivery[]> {
  const sends: Promise<Delivery>[] = [];

  if (destinations.slack) {
    sends.push(post("slack", destinations.slack, { text: formatSlack(f, status) }));
  }
  if (destinations.webhook) {
    sends.push(
      post("webhook", destinations.webhook, {
        source: "stellofi-monitor",
        status,
        name: f.name,
        key: f.key,
        severity: f.severity,
        message: f.message,
        timestamp: new Date().toISOString(),
      })
    );
  }

  if (sends.length === 0) {
    console.warn(`[Monitor] No alert destination configured; ${status} ${f.name}: ${f.message}`);
    return [];
  }
  return Promise.all(sends);
}

async function post(
  destination: Delivery["destination"],
  url: string,
  body: unknown
): Promise<Delivery> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return { destination, ok: res.ok, status: res.status };
  } catch (err) {
    return { destination, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
