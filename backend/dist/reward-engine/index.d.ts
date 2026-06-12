import { PrismaClient } from "@prisma/client";
export declare class RewardEngine {
    private prisma;
    constructor(prisma: PrismaClient);
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    takeSnapshot(): Promise<void>;
    private calculateAPY;
    getCurrentAPY(): Promise<number>;
    /**
     * Derive APR purely from exchange rate history.
     * APR = (currentRate / oldRate - 1) × (365 / daysDiff)
     * Returns 0 if insufficient data (<24h of snapshots).
     */
    getDerivedAPR(): Promise<number>;
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