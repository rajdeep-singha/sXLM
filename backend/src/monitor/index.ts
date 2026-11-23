/**
 * Production monitor.
 *
 * Every `MONITOR_INTERVAL_MINUTES` it reads the chain, applies the rules in
 * checks.ts and delivers changes to Slack and the alert webhook. It never
 * signs anything: responding to an alert (pausing, bumping, funding) is done
 * by people, through the admin multisig where admin power is needed.
 *
 * A check that cannot read its data raises `check_failed` instead of going
 * quiet, so an RPC outage is never mistaken for a healthy protocol.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { PrismaClient } from "@prisma/client";
import { config } from "../config/index.js";
import {
  DEFAULT_THRESHOLDS,
  LEDGERS_PER_DAY,
  checkAdminActivity,
  checkKeeper,
  checkRateFall,
  checkSolvency,
  checkStaleWithdrawals,
  checkTtl,
  checkUtilisation,
  type Finding,
  type Thresholds,
} from "./checks.js";
import { AlertState, type Transition } from "./state.js";
import { deliver, type Status } from "./notify.js";
import {
  readAdminOperations,
  readKeeper,
  readLatestLedger,
  readLending,
  readTtls,
  readVault,
  readWithdrawals,
} from "./sources.js";

export function thresholdsFromConfig(): Thresholds {
  const m = config.monitor;
  return {
    ...DEFAULT_THRESHOLDS,
    ttlMinLedgers: Math.round(m.ttlMinDays * LEDGERS_PER_DAY),
    keeperSilenceMs: m.keeperSilenceHours * 3_600_000,
    keeperMinBalanceStroops: BigInt(Math.round(m.keeperMinXlm * 1e7)),
    utilisationBps: m.utilisationBps,
    withdrawalStaleLedgers: Math.round(m.withdrawalStaleDays * LEDGERS_PER_DAY),
  };
}

/** The keeper address to watch: configured, or derived from the keeper key. */
export function keeperAddress(): string | null {
  if (config.monitor.keeperPublicKey) return config.monitor.keeperPublicKey;
  if (!config.keeper.secretKey) return null;
  try {
    return Keypair.fromSecret(config.keeper.secretKey).publicKey();
  } catch {
    return null;
  }
}

export interface RoundResult {
  at: string;
  findings: Finding[];
  checksRun: string[];
  transitions: Transition[];
}

export class Monitor {
  private readonly state = new AlertState(config.monitor.reminderMs);
  private readonly thresholds = thresholdsFromConfig();
  private lastRate: bigint | null = null;
  private adminCursor: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last: RoundResult | null = null;

  constructor(private readonly prisma?: PrismaClient) {}

  async initialize(): Promise<void> {
    this.lastRate = await this.storedRate();
    // First round in the background: a slow RPC must not hold up API startup.
    void this.tick();
    this.timer = setInterval(() => void this.tick(), config.monitor.intervalMs);
    console.log(
      `[Monitor] Running every ${config.monitor.intervalMs / 60_000} min; ` +
        `alerts to ${[config.webhooks.slackUrl && "Slack", config.webhooks.alertUrl && "webhook"]
          .filter(Boolean)
          .join(" and ") || "NOWHERE (set SLACK_WEBHOOK_URL or ALERT_WEBHOOK_URL)"}`
    );
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Latest stored rate, so a fall during a restart is still noticed. */
  private async storedRate(): Promise<bigint | null> {
    if (!this.prisma) return null;
    try {
      const snap = await this.prisma.rewardSnapshot.findFirst({ orderBy: { timestamp: "desc" } });
      return snap ? BigInt(Math.round(snap.exchangeRate * 1e7)) : null;
    } catch {
      return null;
    }
  }

  private async tick(): Promise<void> {
    try {
      const result = await this.evaluate();
      for (const t of result.transitions) {
        const status: Status = t.kind === "fire" ? "firing" : t.kind === "remind" ? "reminder" : "resolved";
        await deliver(t.finding, status);
        const log = t.kind === "resolve" ? console.log : console.error;
        log(`[Monitor] ${status.toUpperCase()} ${t.finding.name}/${t.finding.key}: ${t.finding.message}`);
      }
    } catch (err) {
      console.error("[Monitor] Round failed:", err);
    }
  }

  /** Run every check once and work out what to send. Sends nothing itself. */
  async evaluate(now = new Date()): Promise<RoundResult> {
    const findings: Finding[] = [];
    const ran = new Set<string>();
    const t = this.thresholds;

    const attempt = async (name: string, fn: () => Promise<Finding[]>) => {
      try {
        findings.push(...(await fn()));
        ran.add(name);
      } catch (err) {
        findings.push({
          name: "check_failed",
          key: name,
          severity: "warning",
          message: `Could not run the ${name} check: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    };

    let latest = 0;
    await attempt("latest_ledger", async () => {
      latest = await readLatestLedger();
      return [];
    });

    await attempt("solvency", async () => {
      const v = await readVault();
      const rateFindings = checkRateFall(this.lastRate, v.rate);
      this.lastRate = v.rate;
      ran.add("rate_fall");
      return [...checkSolvency(v), ...rateFindings];
    });

    if (latest > 0) {
      await attempt("ttl_low", async () => checkTtl(await readTtls(), latest, t));
      await attempt("withdrawal_stale", async () =>
        checkStaleWithdrawals(await readWithdrawals(), latest, t)
      );
    }

    await attempt("utilisation_high", async () => checkUtilisation(await readLending(), t));

    const keeper = keeperAddress();
    if (keeper) {
      await attempt("keeper_silent", async () =>
        checkKeeper({ ...(await readKeeper(keeper)), account: keeper }, now, t)
      );
    } else {
      findings.push({
        name: "keeper_silent",
        key: "config",
        severity: "warning",
        message: "No keeper address configured: set KEEPER_PUBLIC_KEY or KEEPER_SECRET_KEY.",
      });
      ran.add("keeper_silent");
    }

    await attempt("admin_activity", async () => {
      const { ops, cursor } = await readAdminOperations(config.admin.publicKey, this.adminCursor);
      this.adminCursor = cursor;
      return checkAdminActivity(ops, config.admin.publicKey);
    });

    const transitions = this.state.update(findings, now.getTime(), ran);
    this.last = { at: now.toISOString(), findings, checksRun: [...ran], transitions };
    return this.last;
  }

  /** For /health: when the monitor last ran and what is active. */
  status(): { lastRunAt: string | null; active: { name: string; key: string; severity: string }[] } {
    return {
      lastRunAt: this.last?.at ?? null,
      active: this.state.activeFindings().map((f) => ({ name: f.name, key: f.key, severity: f.severity })),
    };
  }
}
