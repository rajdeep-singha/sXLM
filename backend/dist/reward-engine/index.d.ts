import { PrismaClient } from "@prisma/client";
export declare class RewardEngine {
    private prisma;
    constructor(prisma: PrismaClient);
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    /**
     * Distribute rewards by calling add_rewards on the staking contract.
     *
     * Calculates expected rewards based on:
     *   reward = totalStaked × (APR / periodsPerYear)
     *
     * Uses weighted APR from active validators:
     *   r_protocol = Σ(w_i × r_i) where w_i = allocatedStake_i / totalAllocated
     */
    distributeRewards(): Promise<void>;
    takeSnapshot(): Promise<void>;
    private calculateAPY;
    getCurrentAPY(): Promise<number>;
    /**
     * Returns the current validator-weighted net APR.
     * This is what the reward engine actually distributes each period:
     *   weightedAPR = Σ(w_i × BASE_APR × (1 - commission_i))
     * Falls back to BASE_APR if no validators with stake are found.
     */
    getWeightedAPR(): Promise<number>;
    getExchangeRateHistory(days: number): Promise<Array<{
        timestamp: Date;
        exchangeRate: number;
    }>>;
    get7DayYield(): Promise<number>;
    get30DayYield(): Promise<number>;
    private calculatePeriodYield;
    getTotalRewardsDistributed(): Promise<bigint>;
    getLatestSnapshot(): Promise<{
        exchangeRate: number;
        apy: number;
        totalStaked: bigint;
        totalSupply: bigint;
        timestamp: Date;
        yield7d: number;
        yield30d: number;
    } | null>;
}
//# sourceMappingURL=index.d.ts.map