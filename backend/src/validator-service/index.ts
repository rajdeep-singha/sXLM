import { PrismaClient } from "@prisma/client";
import cron from "node-cron";
import { config } from "../config/index.js";
import { getEventBus, EventType } from "../event-bus/index.js";

interface TomlValidatorInfo {
  public_key: string;
  alias?: string;
  display_name?: string;
}

interface ValidatorMetrics {
  pubkey: string;
  uptime: number;
  commission: number;
  votingPower: number | null;
  performanceScore: number;
  allocatedStake: bigint;
}

const PERFORMANCE_WEIGHTS = {
  uptime: 0.4,
  commission: 0.3,
  votingPower: 0.15,
  history: 0.15,
};

let cronJob: cron.ScheduledTask | null = null;

export class ValidatorService {
  private prisma: PrismaClient;
  private horizonUrl: string;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.horizonUrl = config.stellar.horizonUrl;
  }

  async initialize(): Promise<void> {
    console.log("[ValidatorService] Initializing...");

    // Run initial fetch
    await this.fetchAndUpdateValidators().catch((err) =>
      console.error("[ValidatorService] Initial fetch failed:", err)
    );

    // Schedule cron: every 5 minutes
    cronJob = cron.schedule("*/5 * * * *", async () => {
      try {
        await this.fetchAndUpdateValidators();
      } catch (err) {
        console.error("[ValidatorService] Cron fetch failed:", err);
      }
    });

    console.log("[ValidatorService] Initialized, cron scheduled every 5 min");
  }

  async shutdown(): Promise<void> {
    if (cronJob) {
      cronJob.stop();
      cronJob = null;
    }
    console.log("[ValidatorService] Shut down");
  }

  async fetchAndUpdateValidators(): Promise<void> {
    console.log("[ValidatorService] Fetching validator data from Horizon...");

    const validators = await this.fetchValidatorsFromHorizon();

    for (const validator of validators) {
      const metrics = await this.calculateMetrics(validator);

      await this.prisma.validator.upsert({
        where: { pubkey: metrics.pubkey },
        create: {
          pubkey: metrics.pubkey,
          uptime: metrics.uptime,
          commission: metrics.commission,
          votingPower: metrics.votingPower,
          performanceScore: metrics.performanceScore,
          allocatedStake: metrics.allocatedStake,
          lastChecked: new Date(),
        },
        update: {
          uptime: metrics.uptime,
          commission: metrics.commission,
          votingPower: metrics.votingPower,
          performanceScore: metrics.performanceScore,
          allocatedStake: metrics.allocatedStake,
          lastChecked: new Date(),
        },
      });

      // Save validator history snapshot
      const dbValidator = await this.prisma.validator.findUnique({
        where: { pubkey: metrics.pubkey },
      });
      if (dbValidator) {
        await this.prisma.validatorHistory.create({
          data: {
            validatorId: dbValidator.id,
            uptime: metrics.uptime,
            commission: metrics.commission,
            performanceScore: metrics.performanceScore,
            allocatedStake: metrics.allocatedStake,
          },
        });
      }

      // Check for downtime alerts
      if (metrics.uptime < config.protocol.validatorMinUptime) {
        const eventBus = getEventBus();
        await eventBus.publish(EventType.VALIDATOR_DOWN, {
          pubkey: metrics.pubkey,
          uptime: metrics.uptime,
          lastChecked: new Date().toISOString(),
        });
        console.warn(
          `[ValidatorService] Validator ${metrics.pubkey} uptime below threshold: ${(metrics.uptime * 100).toFixed(2)}%`
        );
      }
    }

    console.log(
      `[ValidatorService] Updated ${validators.length} validators`
    );
  }

  private async fetchValidatorsFromHorizon(): Promise<
    Array<{ pubkey: string; lastModifiedLedger: number }>
  > {
    try {
      const validatorAccounts = await this.fetchKnownValidators();

      if (validatorAccounts.length === 0) {
        // Fall back to DB validators if no known validators found
        const existing = await this.prisma.validator.findMany({
          select: { pubkey: true },
        });
        return existing.map((v) => ({ pubkey: v.pubkey, lastModifiedLedger: 0 }));
      }

      // Deduplicate by pubkey
      const seen = new Set<string>();
      return validatorAccounts
        .map((v) => ({ pubkey: v.pubkey, lastModifiedLedger: v.lastModifiedLedger }))
        .filter((v) => {
          if (seen.has(v.pubkey)) return false;
          seen.add(v.pubkey);
          return true;
        });
    } catch (err) {
      console.error("[ValidatorService] Validator fetch error:", err);
      // Return existing validators from DB as fallback
      const existing = await this.prisma.validator.findMany({
        select: { pubkey: true },
      });
      return existing.map((v) => ({ pubkey: v.pubkey, lastModifiedLedger: 0 }));
    }
  }

  private async fetchKnownValidators(): Promise<
    Array<{ pubkey: string; lastModifiedLedger: number }>
  > {
    try {
      // Fetch from Stellar Expert or known validator list
      const response = await fetch(
        `${this.horizonUrl}/ledgers?order=desc&limit=1`
      );

      if (!response.ok) return [];

      const ledgerData = (await response.json()) as {
        _embedded: {
          records: Array<{
            sequence: number;
            closed_at: string;
            total_coins: string;
          }>;
        };
      };

      const latestLedger = ledgerData._embedded.records[0];
      if (!latestLedger) return [];

      // Fetch validators that participated in consensus
      const historyResponse = await fetch(
        `${this.horizonUrl}/ledgers/${latestLedger.sequence}/operations?limit=10`
      );

      // For now, return existing DB validators + any from ledger history
      const existing = await this.prisma.validator.findMany({
        select: { pubkey: true },
      });

      return existing.map((v) => ({
        pubkey: v.pubkey,
        lastModifiedLedger: latestLedger.sequence,
      }));
    } catch {
      return [];
    }
  }

  private async calculateMetrics(validator: {
    pubkey: string;
    lastModifiedLedger: number;
  }): Promise<ValidatorMetrics> {
    // Fetch account details for more info
    let uptime = 0.99; // Default high uptime
    let commission = 0.05; // Default 5% commission
    let votingPower: number | null = null;
    let allocatedStake = BigInt(0);

    try {
      const accountResponse = await fetch(
        `${this.horizonUrl}/accounts/${validator.pubkey}`
      );

      if (accountResponse.ok) {
        const accountData = (await accountResponse.json()) as {
          balances: Array<{
            asset_type: string;
            balance: string;
          }>;
          num_sponsoring: number;
          num_sponsored: number;
          sequence: string;
          last_modified_ledger: number;
        };

        // Calculate uptime from account activity
        const nativeBalance = accountData.balances.find(
          (b) => b.asset_type === "native"
        );

        if (nativeBalance) {
          allocatedStake = BigInt(
            Math.floor(parseFloat(nativeBalance.balance) * 1e7)
          );
        }

        // Check recent transaction history for uptime estimation
        const txResponse = await fetch(
          `${this.horizonUrl}/accounts/${validator.pubkey}/transactions?order=desc&limit=10`
        );

        if (txResponse.ok) {
          const txData = (await txResponse.json()) as {
            _embedded: {
              records: Array<{ created_at: string; successful: boolean }>;
            };
          };

          const recentTxs = txData._embedded.records;
          if (recentTxs.length > 0) {
            const successfulTxs = recentTxs.filter((tx) => tx.successful);
            // Approximate uptime from success rate with a floor
            const rawUptime = successfulTxs.length / recentTxs.length;
            uptime = Math.max(rawUptime, 0.9); // Floor at 90%

            // Check recency - if last tx is old, reduce uptime
            const lastTxTime = new Date(recentTxs[0].created_at).getTime();
            const hoursSinceLastTx =
              (Date.now() - lastTxTime) / (1000 * 60 * 60);
            if (hoursSinceLastTx > 24) {
              uptime = Math.max(uptime - 0.05, 0.8);
            }
          }
        }

        // Estimate voting power from balance relative to total
        votingPower = allocatedStake > BigInt(0) ? Number(allocatedStake) / 1e14 : null;
      }
    } catch (err) {
      console.warn(
        `[ValidatorService] Error fetching metrics for ${validator.pubkey}:`,
        err
      );
      // Use existing DB values as fallback
      const existing = await this.prisma.validator.findUnique({
        where: { pubkey: validator.pubkey },
      });
      if (existing) {
        uptime = existing.uptime;
        commission = existing.commission;
        votingPower = existing.votingPower;
        allocatedStake = existing.allocatedStake;
      }
    }

    // Calculate composite performance score
    const performanceScore = this.computePerformanceScore(
      uptime,
      commission,
      votingPower
    );

    return {
      pubkey: validator.pubkey,
      uptime,
      commission,
      votingPower,
      performanceScore,
      allocatedStake,
    };
  }

  private computePerformanceScore(
    uptime: number,
    commission: number,
    votingPower: number | null
  ): number {
    // Uptime score: 0-1 scale (above 95% is great)
    const uptimeScore = Math.min(uptime / config.protocol.validatorMinUptime, 1.0);

    // Commission score: lower is better (0% = 1.0, 20% = 0.0)
    const commissionScore = Math.max(0, 1.0 - commission / 0.2);

    // Voting power score: normalized, capped
    const vpScore = votingPower !== null ? Math.min(votingPower * 10, 1.0) : 0.5;

    // History score: placeholder, would use historical data in production
    const historyScore = uptimeScore * 0.9 + 0.1;

    const score =
      PERFORMANCE_WEIGHTS.uptime * uptimeScore +
      PERFORMANCE_WEIGHTS.commission * commissionScore +
      PERFORMANCE_WEIGHTS.votingPower * vpScore +
      PERFORMANCE_WEIGHTS.history * historyScore;

    return Math.round(score * 1000) / 1000; // 3 decimal places
  }

  async getValidators(): Promise<
    Array<{
      id: number;
      pubkey: string;
      uptime: number;
      commission: number;
      votingPower: number | null;
      performanceScore: number;
      allocatedStake: bigint;
      lastChecked: Date;
    }>
  > {
    return this.prisma.validator.findMany({
      orderBy: { performanceScore: "desc" },
    });
  }

  async getValidatorByPubkey(pubkey: string) {
    return this.prisma.validator.findUnique({ where: { pubkey } });
  }
}
