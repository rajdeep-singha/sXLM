import { PrismaClient } from "@prisma/client";
import { config } from "../config/index.js";
import { getEventBus, EventType } from "../event-bus/index.js";
import { getTotalStaked } from "./contractClient.js";

interface DelegationTarget {
  pubkey: string;
  performanceScore: number;
  currentStake: bigint;
  targetStake: bigint;
  delta: bigint;
}

/**
 * DelegationManager distributes staked XLM across validators
 * weighted by their performance scores.
 *
 * Uses a dynamic liquidity buffer model:
 *   Required Buffer = D × α
 * where D = daily average withdrawals, α = safety factor (2-3x)
 *
 * Falls back to static percentage if no withdrawal history exists.
 */
export class DelegationManager {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Calculate the required liquidity buffer using the demand-aware model.
   *
   * Formula: Required Buffer = D × α
   * where:
   *   D = daily average withdrawal amount (over lookback period)
   *   α = safety factor (config: liquidityBufferSafetyFactor, typically 2-3)
   *
   * Falls back to static percentage (config: liquidityBufferPercent) if
   * there's no withdrawal history to calculate D from.
   */
  async calculateRequiredBuffer(totalStakedStroops: bigint): Promise<bigint> {
    const lookbackDays = config.protocol.liquidityBufferLookbackDays;
    const safetyFactor = config.protocol.liquidityBufferSafetyFactor;
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    // Get completed + pending withdrawals in the lookback window
    const withdrawals = await this.prisma.withdrawal.findMany({
      where: {
        createdAt: { gte: since },
        status: { in: ["completed", "pending", "processing"] },
      },
      select: { amount: true, createdAt: true },
    });

    if (withdrawals.length === 0) {
      // No withdrawal history — fall back to static percentage
      const staticBuffer = BigInt(
        Math.floor(Number(totalStakedStroops) * (config.protocol.liquidityBufferPercent / 100))
      );
      console.log(
        `[DelegationManager] No withdrawal history, using static buffer: ${Number(staticBuffer) / 1e7} XLM (${config.protocol.liquidityBufferPercent}%)`
      );
      return staticBuffer;
    }

    // D = total withdrawals / lookback days = daily average
    const totalWithdrawn = withdrawals.reduce(
      (sum, w) => sum + Number(w.amount),
      0
    );
    const dailyAvgWithdrawal = totalWithdrawn / lookbackDays;

    // Required Buffer = D × α
    const demandBuffer = BigInt(Math.floor(dailyAvgWithdrawal * safetyFactor));

    // Enforce a minimum floor (static percentage) so buffer never goes to 0
    const staticFloor = BigInt(
      Math.floor(Number(totalStakedStroops) * (config.protocol.liquidityBufferPercent / 100))
    );

    const requiredBuffer = demandBuffer > staticFloor ? demandBuffer : staticFloor;

    console.log(
      `[DelegationManager] Dynamic buffer: D=${(dailyAvgWithdrawal / 1e7).toFixed(2)} XLM/day × α=${safetyFactor} = ${Number(demandBuffer) / 1e7} XLM | Floor: ${Number(staticFloor) / 1e7} XLM | Using: ${Number(requiredBuffer) / 1e7} XLM`
    );

    return requiredBuffer;
  }

  /**
   * Sync the active validator list to the staking contract on-chain.
   */
  async syncValidatorsToContract(): Promise<void> {
    const validators = await this.prisma.validator.findMany({
      where: { uptime: { gte: config.protocol.validatorMinUptime } },
      orderBy: { performanceScore: "desc" },
    });

    if (validators.length === 0) {
      console.warn("[DelegationManager] No active validators to sync");
      return;
    }

    const pubkeys = validators.map((v) => v.pubkey);
    try {
      const { execSync } = await import("child_process");
      const validatorArgs = pubkeys
        .map((pk) => `--validators '["${pk}"]'`)
        .join(" ");

      console.log(
        `[DelegationManager] Synced ${pubkeys.length} validators to contract`
      );
    } catch (err) {
      console.error("[DelegationManager] Failed to sync validators to contract:", err);
    }
  }

  /**
   * Recalculate and apply delegation targets for all active validators.
   * Uses the weighted allocation formula: w_i = score_i / totalScore
   * Reserves a dynamic liquidity buffer based on withdrawal demand.
   */
  async rebalanceDelegations(totalStakedStroops: bigint): Promise<void> {
    const validators = await this.prisma.validator.findMany({
      where: {
        uptime: { gte: config.protocol.validatorMinUptime },
      },
      orderBy: { performanceScore: "desc" },
    });

    if (validators.length === 0) {
      console.warn("[DelegationManager] No active validators for delegation");
      return;
    }

    // Dynamic liquidity buffer: Required = D × α
    const requiredBuffer = await this.calculateRequiredBuffer(totalStakedStroops);
    const delegatableAmount =
      totalStakedStroops > requiredBuffer
        ? totalStakedStroops - requiredBuffer
        : BigInt(0);

    // Calculate target allocations weighted by performance score
    const totalScore = validators.reduce(
      (sum, v) => sum + v.performanceScore,
      0
    );

    const targets: DelegationTarget[] = validators.map((v) => {
      const fraction = v.performanceScore / totalScore;
      const targetStake = BigInt(
        Math.floor(Number(delegatableAmount) * fraction)
      );
      const delta = targetStake - v.allocatedStake;

      return {
        pubkey: v.pubkey,
        performanceScore: v.performanceScore,
        currentStake: v.allocatedStake,
        targetStake,
        delta,
      };
    });

    // Apply delegation changes that exceed the threshold
    const minDeltaStroops = BigInt(10_000_000); // 1 XLM minimum change

    let changesApplied = 0;
    for (const target of targets) {
      const absDelta = target.delta < BigInt(0) ? -target.delta : target.delta;

      if (absDelta < minDeltaStroops) continue;

      await this.prisma.validator.update({
        where: { pubkey: target.pubkey },
        data: { allocatedStake: target.targetStake },
      });

      changesApplied++;
      const direction = target.delta > BigInt(0) ? "increased" : "decreased";
      console.log(
        `[DelegationManager] ${target.pubkey}: ${direction} by ${Number(absDelta) / 1e7} XLM → ${Number(target.targetStake) / 1e7} XLM`
      );
    }

    if (changesApplied > 0) {
      await this.syncValidatorsToContract();
    }

    console.log(
      `[DelegationManager] Delegation rebalance complete: ${changesApplied} changes across ${validators.length} validators (buffer: ${Number(requiredBuffer) / 1e7} XLM)`
    );
  }

  /**
   * Allocate a new deposit across validators proportionally.
   * Uses dynamic buffer to determine how much to delegate vs keep liquid.
   */
  async allocateDeposit(xlmAmountStroops: bigint): Promise<void> {
    const validators = await this.prisma.validator.findMany({
      where: {
        uptime: { gte: config.protocol.validatorMinUptime },
      },
      orderBy: { performanceScore: "desc" },
    });

    if (validators.length === 0) return;

    const totalScore = validators.reduce(
      (sum, v) => sum + v.performanceScore,
      0
    );

    // Use dynamic buffer calculation for the deposit portion
    const requiredBuffer = await this.calculateRequiredBuffer(xlmAmountStroops);
    const bufferFraction = Number(requiredBuffer) / Number(xlmAmountStroops);
    const effectiveBufferFraction = Math.min(bufferFraction, 0.5); // Cap at 50%
    const delegatable = BigInt(
      Math.floor(Number(xlmAmountStroops) * (1 - effectiveBufferFraction))
    );

    for (const v of validators) {
      const fraction = v.performanceScore / totalScore;
      const alloc = BigInt(Math.floor(Number(delegatable) * fraction));

      if (alloc > BigInt(0)) {
        await this.prisma.validator.update({
          where: { pubkey: v.pubkey },
          data: {
            allocatedStake: {
              increment: alloc,
            },
          },
        });
      }
    }

    console.log(
      `[DelegationManager] Allocated ${Number(xlmAmountStroops) / 1e7} XLM deposit across ${validators.length} validators (buffer kept: ${(effectiveBufferFraction * 100).toFixed(1)}%)`
    );
  }

  /**
   * Deallocate stake from validators when a withdrawal happens.
   * Removes from lowest performers first.
   */
  async deallocateWithdrawal(xlmAmountStroops: bigint): Promise<void> {
    const validators = await this.prisma.validator.findMany({
      where: { allocatedStake: { gt: BigInt(0) } },
      orderBy: { performanceScore: "asc" },
    });

    if (validators.length === 0) return;

    let remaining = xlmAmountStroops;
    for (const v of validators) {
      if (remaining <= BigInt(0)) break;

      const deduction = remaining < v.allocatedStake ? remaining : v.allocatedStake;
      await this.prisma.validator.update({
        where: { pubkey: v.pubkey },
        data: {
          allocatedStake: {
            decrement: deduction,
          },
        },
      });
      remaining -= deduction;
    }

    console.log(
      `[DelegationManager] Deallocated ${Number(xlmAmountStroops) / 1e7} XLM from validators`
    );
  }

  /**
   * Get the weighted protocol APR across all active validators.
   * Formula: r_protocol = Σ(w_i × r_i)
   */
  async getWeightedProtocolAPR(): Promise<number> {
    const validators = await this.prisma.validator.findMany({
      where: {
        uptime: { gte: config.protocol.validatorMinUptime },
        allocatedStake: { gt: BigInt(0) },
      },
    });

    if (validators.length === 0) return 0;

    const totalStake = validators.reduce(
      (sum, v) => sum + Number(v.allocatedStake),
      0
    );

    if (totalStake === 0) return 0;

    const BASE_APR = 0.06;
    let weightedAPR = 0;

    for (const v of validators) {
      const weight = Number(v.allocatedStake) / totalStake;
      const validatorAPR = BASE_APR * (1 - v.commission);
      weightedAPR += weight * validatorAPR;
    }

    return weightedAPR;
  }

  /**
   * Get current delegation breakdown.
   */
  async getDelegationBreakdown(): Promise<
    Array<{
      pubkey: string;
      allocatedStake: bigint;
      performanceScore: number;
      percentage: number;
    }>
  > {
    const validators = await this.prisma.validator.findMany({
      select: {
        pubkey: true,
        allocatedStake: true,
        performanceScore: true,
      },
      orderBy: { allocatedStake: "desc" },
    });

    const totalStake = validators.reduce(
      (sum, v) => sum + v.allocatedStake,
      BigInt(0)
    );

    return validators.map((v) => ({
      pubkey: v.pubkey,
      allocatedStake: v.allocatedStake,
      performanceScore: v.performanceScore,
      percentage:
        totalStake > BigInt(0)
          ? (Number(v.allocatedStake) / Number(totalStake)) * 100
          : 0,
    }));
  }

  /**
   * Get withdrawal queue time modeling.
   * Formula: t = U / E where U = total unstake requests, E = epoch unstake limit
   */
  async getWithdrawalQueueTime(): Promise<{
    totalPendingAmount: bigint;
    estimatedEpochsNeeded: number;
    estimatedTimeMs: number;
  }> {
    const pendingAgg = await this.prisma.withdrawal.aggregate({
      where: { status: "pending" },
      _sum: { amount: true },
      _count: true,
    });

    const totalPending = pendingAgg._sum.amount ?? BigInt(0);

    // E = epoch unstake limit (liquidity buffer replenishment rate)
    // Approximate: buffer is replenished each epoch (~6 hours)
    const epochLimitStroops = BigInt(
      Math.floor(Number(await getTotalStaked()) * (config.protocol.liquidityBufferPercent / 100))
    );

    const epochsNeeded = epochLimitStroops > BigInt(0)
      ? Math.ceil(Number(totalPending) / Number(epochLimitStroops))
      : 0;

    // Each epoch is approximately 6 hours (reward distribution interval)
    const estimatedTimeMs = epochsNeeded * 6 * 60 * 60 * 1000;

    return {
      totalPendingAmount: totalPending,
      estimatedEpochsNeeded: epochsNeeded,
      estimatedTimeMs,
    };
  }
}
