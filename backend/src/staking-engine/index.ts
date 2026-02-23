import { PrismaClient } from "@prisma/client";
import {
  startPeriodicRefresh as startExchangeRateRefresh,
  stopPeriodicRefresh as stopExchangeRateRefresh,
  getCurrentRate,
} from "./exchangeRateManager.js";
import {
  startWithdrawalQueueProcessor,
  stopWithdrawalQueueProcessor,
  getQueueStats,
} from "./withdrawalQueueProcessor.js";
import {
  getTotalStaked,
  getTotalSupply,
  getLiquidityBuffer,
  getTreasuryBalance,
  getIsPaused,
  getProtocolFeeBps,
  callApplySlashing,
  callPause,
  callUnpause,
  callRecalibrateRate,
} from "./contractClient.js";
import { DelegationManager } from "./delegationManager.js";
import { getEventBus, EventType } from "../event-bus/index.js";

export class StakingEngine {
  private prisma: PrismaClient;
  private delegationManager: DelegationManager;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.delegationManager = new DelegationManager(prisma);
  }

  async initialize(): Promise<void> {
    console.log("[StakingEngine] Initializing...");
    startExchangeRateRefresh();
    startWithdrawalQueueProcessor(this.prisma);

    // Subscribe to deposit events → allocate to validators
    const eventBus = getEventBus();
    await eventBus.subscribe(EventType.STAKE_EXECUTED, async (data) => {
      const amount = BigInt(data.xlmAmount);
      if (amount > BigInt(0)) {
        await this.delegationManager.allocateDeposit(amount);
        console.log(`[StakingEngine] Allocated deposit of ${Number(amount) / 1e7} XLM to validators`);
      }
    });

    // Subscribe to withdrawal events → deallocate from validators
    await eventBus.subscribe(EventType.UNSTAKE_EXECUTED, async (data) => {
      const amount = BigInt(data.xlmAmount);
      if (amount > BigInt(0)) {
        await this.delegationManager.deallocateWithdrawal(amount);
        console.log(`[StakingEngine] Deallocated ${Number(amount) / 1e7} XLM from validators`);
      }
    });

    // Subscribe to slashing events → recalculate withdrawal queue
    await eventBus.subscribe(EventType.SLASHING_APPLIED, async (data) => {
      const slashAmount = BigInt(data.amount);
      await this.recalculateWithdrawalQueueAfterSlash(slashAmount);
    });

    console.log("[StakingEngine] Initialized successfully");
  }

  async shutdown(): Promise<void> {
    console.log("[StakingEngine] Shutting down...");
    stopExchangeRateRefresh();
    stopWithdrawalQueueProcessor();
    console.log("[StakingEngine] Shut down");
  }

  async getExchangeRate(): Promise<number> {
    return getCurrentRate();
  }

  async getProtocolStats(): Promise<{
    totalStaked: bigint;
    totalSupply: bigint;
    exchangeRate: number;
    liquidityBuffer: bigint;
    treasuryBalance: bigint;
    isPaused: boolean;
    protocolFeeBps: number;
  }> {
    const [totalStaked, totalSupply, exchangeRate, liquidityBuffer, treasuryBalance, isPaused, protocolFeeBps] =
      await Promise.all([
        getTotalStaked(),
        getTotalSupply(),
        getCurrentRate(),
        getLiquidityBuffer(),
        getTreasuryBalance().catch(() => BigInt(0)),
        getIsPaused().catch(() => false),
        getProtocolFeeBps().catch(() => 1000),
      ]);

    return { totalStaked, totalSupply, exchangeRate, liquidityBuffer, treasuryBalance, isPaused, protocolFeeBps };
  }

  async getWithdrawalQueueStats() {
    return getQueueStats(this.prisma);
  }

  async getDelegationBreakdown() {
    return this.delegationManager.getDelegationBreakdown();
  }

  async getWeightedProtocolAPR() {
    return this.delegationManager.getWeightedProtocolAPR();
  }

  async rebalanceDelegations() {
    const totalStaked = await getTotalStaked();
    return this.delegationManager.rebalanceDelegations(totalStaked);
  }

  /**
   * Fix #4: Recalculate pending withdrawal amounts after slashing.
   * When slashing reduces total_xlm, the exchange rate drops.
   * Pending withdrawals should reflect the new (lower) exchange rate.
   */
  async recalculateWithdrawalQueueAfterSlash(slashAmount: bigint): Promise<void> {
    const [totalStaked, totalSupply] = await Promise.all([
      getTotalStaked(),
      getTotalSupply(),
    ]);

    if (totalSupply === BigInt(0)) return;

    // New exchange rate after slashing: ER = totalStaked / totalSupply
    // (slashing already reduced totalStaked on-chain)
    const newER = Number(totalStaked) / Number(totalSupply);
    const oldER = Number(totalStaked + slashAmount) / Number(totalSupply);

    if (oldER <= 0) return;

    const reductionFactor = newER / oldER;

    // Get all pending withdrawals
    const pendingWithdrawals = await this.prisma.withdrawal.findMany({
      where: { status: "pending" },
    });

    if (pendingWithdrawals.length === 0) return;

    let recalculated = 0;
    for (const w of pendingWithdrawals) {
      const newAmount = BigInt(Math.floor(Number(w.amount) * reductionFactor));
      if (newAmount !== w.amount) {
        await this.prisma.withdrawal.update({
          where: { id: w.id },
          data: { amount: newAmount },
        });
        recalculated++;
      }
    }

    console.log(
      `[StakingEngine] Slashing recalculation: ${recalculated} pending withdrawals adjusted by factor ${reductionFactor.toFixed(6)} (slash: ${Number(slashAmount) / 1e7} XLM)`
    );
  }

  // --- Admin operations ---

  async applySlashing(slashAmountStroops: bigint): Promise<string> {
    // apply_slashing already emits recalib event on-chain
    const result = await callApplySlashing(slashAmountStroops);

    // Explicit ER recalibration call to ensure event is emitted
    try {
      await callRecalibrateRate();
      console.log("[StakingEngine] Exchange rate recalibrated on-chain after slashing");
    } catch (err) {
      console.error("[StakingEngine] Recalibration call failed (ER still auto-adjusts):", err);
    }

    // Emit slashing event so withdrawal queue gets recalculated
    const eventBus = getEventBus();
    await eventBus.publish(EventType.SLASHING_APPLIED, {
      amount: slashAmountStroops,
      reason: "admin",
      timestamp: Date.now(),
    });

    return result;
  }

  async pause(): Promise<string> {
    return callPause();
  }

  async unpause(): Promise<string> {
    return callUnpause();
  }
}
