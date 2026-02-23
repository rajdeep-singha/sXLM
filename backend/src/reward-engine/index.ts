import { PrismaClient } from "@prisma/client";
import { getTotalStaked, getTotalSupply, callAddRewards, callUpdateLendingExchangeRate } from "../staking-engine/contractClient.js";
import { computeExchangeRate } from "../staking-engine/exchangeRateManager.js";
import { getEventBus, EventType } from "../event-bus/index.js";
import { config } from "../config/index.js";

let snapshotInterval: ReturnType<typeof setInterval> | null = null;
let rewardDistributionInterval: ReturnType<typeof setInterval> | null = null;

// Reward distribution constants
const BASE_APR = 0.06; // 6% base APR for Stellar validators
const REWARD_DISTRIBUTION_INTERVAL_MS = 6 * 60 * 60 * 1000; // Every 6 hours

export class RewardEngine {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async initialize(): Promise<void> {
    console.log("[RewardEngine] Initializing...");

    // Initial snapshot
    await this.takeSnapshot().catch((err) =>
      console.error("[RewardEngine] Initial snapshot failed:", err)
    );

    // Periodic snapshots
    snapshotInterval = setInterval(async () => {
      try {
        await this.takeSnapshot();
      } catch (err) {
        console.error("[RewardEngine] Snapshot error:", err);
      }
    }, config.protocol.rewardSnapshotIntervalMs);

    // NOTE: Simulated APR distribution is DISABLED.
    // Real yield is harvested by the KeeperBot from lending interest every 6h.
    // RewardEngine only handles snapshots and APY tracking.
    console.log(
      `[RewardEngine] Initialized, snapshotting every ${config.protocol.rewardSnapshotIntervalMs / 1000}s (reward distribution handled by KeeperBot)`
    );
  }

  async shutdown(): Promise<void> {
    if (snapshotInterval) {
      clearInterval(snapshotInterval);
      snapshotInterval = null;
    }
    if (rewardDistributionInterval) {
      clearInterval(rewardDistributionInterval);
      rewardDistributionInterval = null;
    }
    console.log("[RewardEngine] Shut down");
  }

  // Kept for manual/admin use only — not called automatically
  // Real rewards come from KeeperBot harvesting lending interest

  /**
   * Distribute rewards by calling add_rewards on the staking contract.
   *
   * Calculates expected rewards based on:
   *   reward = totalStaked × (APR / periodsPerYear)
   *
   * Uses weighted APR from active validators:
   *   r_protocol = Σ(w_i × r_i) where w_i = allocatedStake_i / totalAllocated
   */
  async distributeRewards(): Promise<void> {
    const totalStaked = await getTotalStaked();

    if (totalStaked <= BigInt(0)) {
      console.log("[RewardEngine] No stake to distribute rewards for");
      return;
    }

    // Calculate weighted APR from validators
    const validators = await this.prisma.validator.findMany({
      where: {
        uptime: { gte: config.protocol.validatorMinUptime },
        allocatedStake: { gt: BigInt(0) },
      },
    });

    let weightedAPR = BASE_APR;

    if (validators.length > 0) {
      const totalAllocated = validators.reduce(
        (sum, v) => sum + Number(v.allocatedStake),
        0
      );

      if (totalAllocated > 0) {
        weightedAPR = 0;
        for (const v of validators) {
          const weight = Number(v.allocatedStake) / totalAllocated;
          // Net APR after validator commission
          const validatorAPR = BASE_APR * (1 - v.commission);
          weightedAPR += weight * validatorAPR;
        }
      }
    }

    // Compound reward accrual: P_new = P × (1 + r/n)^1 - P
    // where r = weighted APR, n = periods per year
    // Each distribution is one period, so we compute one compounding step
    const periodsPerYear = (365 * 24 * 60 * 60 * 1000) / REWARD_DISTRIBUTION_INTERVAL_MS;
    const compoundedValue = Number(totalStaked) * Math.pow(1 + weightedAPR / periodsPerYear, 1);
    const rewardAmount = BigInt(
      Math.floor(compoundedValue - Number(totalStaked))
    );

    if (rewardAmount <= BigInt(0)) {
      console.log("[RewardEngine] Reward amount too small to distribute");
      return;
    }

    try {
      await callAddRewards(rewardAmount);
      console.log(
        `[RewardEngine] Distributed ${Number(rewardAmount) / 1e7} XLM in rewards (weighted APR: ${(weightedAPR * 100).toFixed(2)}%)`
      );

      // Update protocol metrics with accumulated fees
      // Protocol takes PROTOCOL_FEE_BPS (10%) of gross rewards
      const protocolFee = rewardAmount * BigInt(1000) / BigInt(10000);
      // Update the latest protocol metrics row only
      const latestMetrics = await this.prisma.protocolMetrics.findFirst({
        orderBy: { id: "desc" },
      });
      if (latestMetrics) {
        await this.prisma.protocolMetrics.update({
          where: { id: latestMetrics.id },
          data: {
            protocolFees: { increment: protocolFee },
          },
        });
      }
    } catch (err) {
      console.error("[RewardEngine] Failed to distribute rewards on-chain:", err);
    }
  }

  async takeSnapshot(): Promise<void> {
    const [totalStaked, totalSupply] = await Promise.all([
      getTotalStaked(),
      getTotalSupply(),
    ]);

    const exchangeRate = computeExchangeRate(totalStaked, totalSupply);
    const apy = await this.calculateAPY(exchangeRate);

    await this.prisma.rewardSnapshot.create({
      data: {
        totalStaked,
        totalSupply,
        exchangeRate,
        apy,
      },
    });

    // Sync exchange rate to lending contract (best effort — don't fail snapshot on error)
    callUpdateLendingExchangeRate(exchangeRate).catch((err) =>
      console.warn("[RewardEngine] Lending rate sync failed (non-fatal):", err)
    );

    // Publish reward update event
    const eventBus = getEventBus();
    await eventBus.publish(EventType.REWARD_UPDATED, {
      exchangeRate,
      apy,
      totalStaked,
      totalSupply,
      timestamp: Date.now(),
    });

    console.log(
      `[RewardEngine] Snapshot: rate=${exchangeRate.toFixed(7)}, apy=${(apy * 100).toFixed(2)}%`
    );
  }

  private async calculateAPY(currentRate: number): Promise<number> {
    // Fetch the snapshot from ~365 days ago (or oldest available)
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    const oldestSnapshot = await this.prisma.rewardSnapshot.findFirst({
      where: {
        timestamp: { gte: oneYearAgo },
      },
      orderBy: { timestamp: "asc" },
    });

    if (!oldestSnapshot) {
      // No historical data; try to estimate from recent data
      const recentSnapshot = await this.prisma.rewardSnapshot.findFirst({
        orderBy: { timestamp: "desc" },
        skip: 1,
      });

      if (!recentSnapshot) {
        return 0;
      }

      const timeDiffMs =
        Date.now() - recentSnapshot.timestamp.getTime();
      if (timeDiffMs < 60_000) return 0;

      const rateGrowth = currentRate / recentSnapshot.exchangeRate - 1;
      const periodsPerYear =
        (365 * 24 * 60 * 60 * 1000) / timeDiffMs;

      const annualizedReturn = Math.pow(1 + rateGrowth, periodsPerYear) - 1;

      return Math.max(0, Math.min(annualizedReturn, 0.5));
    }

    const timeDiffMs =
      Date.now() - oldestSnapshot.timestamp.getTime();
    const yearFraction = timeDiffMs / (365 * 24 * 60 * 60 * 1000);

    if (yearFraction < 0.001) return 0;

    const totalReturn = currentRate / oldestSnapshot.exchangeRate - 1;
    const annualizedReturn = Math.pow(1 + totalReturn, 1 / yearFraction) - 1;

    return Math.max(0, Math.min(annualizedReturn, 0.5));
  }

  async getCurrentAPY(): Promise<number> {
    const latest = await this.prisma.rewardSnapshot.findFirst({
      orderBy: { timestamp: "desc" },
    });
    return latest?.apy ?? 0;
  }

  /**
   * Returns the current validator-weighted net APR.
   * This is what the reward engine actually distributes each period:
   *   weightedAPR = Σ(w_i × BASE_APR × (1 - commission_i))
   * Falls back to BASE_APR if no validators with stake are found.
   */
  async getWeightedAPR(): Promise<number> {
    const validators = await this.prisma.validator.findMany({
      where: {
        uptime: { gte: config.protocol.validatorMinUptime },
        allocatedStake: { gt: BigInt(0) },
      },
    });

    if (validators.length === 0) return BASE_APR;

    const totalAllocated = validators.reduce(
      (sum, v) => sum + Number(v.allocatedStake),
      0
    );

    if (totalAllocated === 0) return BASE_APR;

    let weightedAPR = 0;
    for (const v of validators) {
      const weight = Number(v.allocatedStake) / totalAllocated;
      weightedAPR += weight * BASE_APR * (1 - v.commission);
    }

    return weightedAPR;
  }

  async getExchangeRateHistory(
    days: number
  ): Promise<Array<{ timestamp: Date; exchangeRate: number }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.prisma.rewardSnapshot.findMany({
      where: { timestamp: { gte: since } },
      select: { timestamp: true, exchangeRate: true },
      orderBy: { timestamp: "asc" },
    });
  }

  async get7DayYield(): Promise<number> {
    return this.calculatePeriodYield(7);
  }

  async get30DayYield(): Promise<number> {
    return this.calculatePeriodYield(30);
  }

  private async calculatePeriodYield(days: number): Promise<number> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [oldest, latest] = await Promise.all([
      this.prisma.rewardSnapshot.findFirst({
        where: { timestamp: { gte: since } },
        orderBy: { timestamp: "asc" },
      }),
      this.prisma.rewardSnapshot.findFirst({
        orderBy: { timestamp: "desc" },
      }),
    ]);

    if (!oldest || !latest || oldest.id === latest.id) {
      return 0;
    }

    const rateGrowth = latest.exchangeRate / oldest.exchangeRate - 1;
    return Math.max(0, rateGrowth);
  }

  async getTotalRewardsDistributed(): Promise<bigint> {
    const latest = await this.prisma.rewardSnapshot.findFirst({
      orderBy: { timestamp: "desc" },
    });

    if (!latest) return BigInt(0);

    const initialXlmEquivalent = latest.totalSupply;

    if (latest.totalStaked > initialXlmEquivalent) {
      return latest.totalStaked - initialXlmEquivalent;
    }

    return BigInt(0);
  }

  async getLatestSnapshot(): Promise<{
    exchangeRate: number;
    apy: number;
    totalStaked: bigint;
    totalSupply: bigint;
    timestamp: Date;
    yield7d: number;
    yield30d: number;
  } | null> {
    const latest = await this.prisma.rewardSnapshot.findFirst({
      orderBy: { timestamp: "desc" },
    });

    if (!latest) return null;

    const [yield7d, yield30d] = await Promise.all([
      this.get7DayYield(),
      this.get30DayYield(),
    ]);

    return {
      exchangeRate: latest.exchangeRate,
      apy: latest.apy,
      totalStaked: latest.totalStaked,
      totalSupply: latest.totalSupply,
      timestamp: latest.timestamp,
      yield7d,
      yield30d,
    };
  }
}
