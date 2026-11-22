import { PrismaClient } from "@prisma/client";
import {
  getIdleBalance,
  getPendingWithdrawals,
  getTreasuryBalance,
  getTotalStaked,
  getTotalSupply,
  getIsPaused,
} from "../vault-engine/contractClient.js";
import { config } from "../config/index.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Risk Engine
 *
 * Watches the one invariant the protocol documentation actually commits to:
 *
 *   total assets >= redeemable liabilities, unless a loss event is declared
 *
 * Strategy exposure and collateral concentration are not monitored; they need
 * the strategy registry before they can be measured.
 *
 * It alerts and does not act. Pausing is an admin action, and the admin is a
 * multisig account: on a shortfall, the signers pause the vault themselves.
 * It also never unpauses: reopening after a shortfall needs a person to
 * establish why assets fell, not a balance that happens to read healthy again.
 */
export class RiskEngine {
  private prisma: PrismaClient;
  private emergencyMode = false;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async initialize(): Promise<void> {
    console.log("[RiskEngine] Initializing solvency watch...");

    await this.runSolvencyCheck().catch((err) =>
      console.error("[RiskEngine] Initial solvency check failed:", err)
    );

    this.interval = setInterval(async () => {
      try {
        await this.runSolvencyCheck();
      } catch (err) {
        console.error("[RiskEngine] Solvency check error:", err);
      }
    }, CHECK_INTERVAL_MS);

    console.log(
      `[RiskEngine] Initialized, checking every ${CHECK_INTERVAL_MS / 1000}s`
    );
  }

  async shutdown(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log("[RiskEngine] Shut down");
  }

  /**
   * Compare what the vault holds against everything it owes.
   *
   * Share claims are `total_assets`, which the contract already derives net of
   * queued withdrawals and accrued fees. A shortfall against the raw balance
   * means the contract is promising XLM it does not hold.
   */
  private async runSolvencyCheck(): Promise<void> {
    const [idle, pending, treasury, assets, supply, paused] = await Promise.all([
      getIdleBalance(),
      getPendingWithdrawals(),
      getTreasuryBalance(),
      getTotalStaked(),
      getTotalSupply(),
      getIsPaused(),
    ]);

    const { liabilities, shortfall } = assessSolvency({ idle, pending, treasury, assets });

    if (shortfall > BigInt(0)) {
      console.error(
        `[RiskEngine] SOLVENCY SHORTFALL: holds ${fmt(idle)} XLM, owes ${fmt(liabilities)} XLM ` +
          `(shares ${fmt(assets)}, queued ${fmt(pending)}, fees ${fmt(treasury)}) — short ${fmt(shortfall)} XLM`
      );

      if (!this.emergencyMode) {
        this.emergencyMode = true;
        await this.notify(
          "SOLVENCY",
          `Vault is short ${fmt(shortfall)} XLM against its obligations. ` +
            (paused
              ? "Vault is already paused."
              : "ACTION REQUIRED: pause the vault through the admin multisig (docs/OPERATIONS.md).")
        );
      }
      return;
    }

    if (this.emergencyMode) {
      this.emergencyMode = false;
      await this.notify(
        "SOLVENCY",
        "Vault reads solvent again. It stays paused until the signers establish the cause and unpause."
      );
    }

    const rate = supply > BigInt(0) ? Number(assets) / Number(supply) : 1;
    console.log(
      `[RiskEngine] Solvent: holds ${fmt(idle)} XLM, owes ${fmt(liabilities)} XLM, rate ${rate.toFixed(7)}`
    );
  }

  private async notify(kind: string, message: string): Promise<void> {
    const posts: Promise<Response>[] = [];
    if (config.webhooks.governanceUrl) {
      posts.push(
        fetch(config.webhooks.governanceUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, message, timestamp: Date.now() }),
        })
      );
    }
    if (config.webhooks.slackUrl) {
      posts.push(
        fetch(config.webhooks.slackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: `[${kind}] ${message}` }),
        })
      );
    }
    if (posts.length === 0) {
      console.warn(`[RiskEngine] No webhook configured; alert not delivered: ${message}`);
      return;
    }
    const results = await Promise.allSettled(posts);
    for (const r of results) {
      if (r.status === "rejected") {
        console.warn("[RiskEngine] Notification failed:", r.reason);
      }
    }
  }

  isEmergencyMode(): boolean {
    return this.emergencyMode;
  }
}

/**
 * What the vault owes against what it holds.
 *
 * `assets` is what share holders can redeem; queued withdrawals and accrued
 * fees are owed on top of it. All of it must be covered by the idle balance.
 */
export function assessSolvency(input: {
  idle: bigint;
  pending: bigint;
  treasury: bigint;
  assets: bigint;
}): { liabilities: bigint; shortfall: bigint } {
  const liabilities = input.assets + input.pending + input.treasury;
  return { liabilities, shortfall: liabilities - input.idle };
}

function fmt(stroops: bigint): string {
  return (Number(stroops) / 1e7).toFixed(7);
}
