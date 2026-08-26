import { PrismaClient } from "@prisma/client";
import {
  callPause,
  callUnpause,
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
 * Everything this service used to do was validator monitoring — uptime scores,
 * allocation drift, reallocation between validators. Stellar has no validator
 * staking, so that was watching a fiction. This watches balances instead.
 *
 * The wider risk surface the docs describe — strategy exposure, oracle status,
 * collateral concentration — needs the strategy registry before it can be
 * measured, and is deliberately absent rather than stubbed.
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

    const liabilities = assets + pending + treasury;
    const shortfall = liabilities - idle;

    if (shortfall > BigInt(0)) {
      console.error(
        `[RiskEngine] SOLVENCY SHORTFALL: holds ${fmt(idle)} XLM, owes ${fmt(liabilities)} XLM ` +
          `(shares ${fmt(assets)}, queued ${fmt(pending)}, fees ${fmt(treasury)}) — short ${fmt(shortfall)} XLM`
      );

      if (!this.emergencyMode) {
        this.emergencyMode = true;
        if (!paused) {
          try {
            await callPause();
            console.error("[RiskEngine] Protocol paused on solvency shortfall");
          } catch (err) {
            console.error("[RiskEngine] Pause failed:", err);
          }
        }
        await this.notify(
          "SOLVENCY",
          `Vault is short ${fmt(shortfall)} XLM against its obligations. Protocol paused.`
        );
      }
      return;
    }

    if (this.emergencyMode) {
      this.emergencyMode = false;
      if (paused) {
        try {
          await callUnpause();
          console.log("[RiskEngine] Solvency restored — protocol unpaused");
        } catch (err) {
          console.error("[RiskEngine] Unpause failed:", err);
        }
      }
      await this.notify("SOLVENCY", "Vault is solvent again. Protocol unpaused.");
    }

    const rate = supply > BigInt(0) ? Number(assets) / Number(supply) : 1;
    console.log(
      `[RiskEngine] Solvent: holds ${fmt(idle)} XLM, owes ${fmt(liabilities)} XLM, rate ${rate.toFixed(7)}`
    );
  }

  private async notify(kind: string, message: string): Promise<void> {
    const url = config.webhooks.governanceUrl;
    if (!url) return;
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, message, timestamp: Date.now() }),
      });
    } catch (err) {
      console.warn("[RiskEngine] Notification failed:", err);
    }
  }

  isEmergencyMode(): boolean {
    return this.emergencyMode;
  }
}

function fmt(stroops: bigint): string {
  return (Number(stroops) / 1e7).toFixed(7);
}
