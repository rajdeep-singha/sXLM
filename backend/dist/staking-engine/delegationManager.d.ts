import { PrismaClient } from "@prisma/client";
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
export declare class DelegationManager {
    private prisma;
    constructor(prisma: PrismaClient);
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
    calculateRequiredBuffer(totalStakedStroops: bigint): Promise<bigint>;
    /**
     * Sync the active validator list to the staking contract on-chain.
     */
    syncValidatorsToContract(): Promise<void>;
    /**
     * Recalculate and apply delegation targets for all active validators.
     * Uses the weighted allocation formula: w_i = score_i / totalScore
     * Reserves a dynamic liquidity buffer based on withdrawal demand.
     */
    rebalanceDelegations(totalStakedStroops: bigint): Promise<void>;
    /**
     * Allocate a new deposit across validators proportionally.
     * Uses dynamic buffer to determine how much to delegate vs keep liquid.
     */
    allocateDeposit(xlmAmountStroops: bigint): Promise<void>;
    /**
     * Deallocate stake from validators when a withdrawal happens.
     * Removes from lowest performers first.
     */
    deallocateWithdrawal(xlmAmountStroops: bigint): Promise<void>;
    /**
     * Get the weighted protocol APR across all active validators.
     * Formula: r_protocol = Σ(w_i × r_i)
     */
    getWeightedProtocolAPR(): Promise<number>;
    /**
     * Get current delegation breakdown.
     */
    getDelegationBreakdown(): Promise<Array<{
        pubkey: string;
        allocatedStake: bigint;
        performanceScore: number;
        percentage: number;
    }>>;
    /**
     * Get withdrawal queue time modeling.
     * Formula: t = U / E where U = total unstake requests, E = epoch unstake limit
     */
    getWithdrawalQueueTime(): Promise<{
        totalPendingAmount: bigint;
        estimatedEpochsNeeded: number;
        estimatedTimeMs: number;
    }>;
}
//# sourceMappingURL=delegationManager.d.ts.map