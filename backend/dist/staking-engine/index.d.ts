import { PrismaClient } from "@prisma/client";
export declare class StakingEngine {
    private prisma;
    constructor(prisma: PrismaClient);
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    getExchangeRate(): Promise<number>;
    getProtocolStats(): Promise<{
        totalStaked: bigint;
        totalSupply: bigint;
        exchangeRate: number;
        liquidityBuffer: bigint;
        treasuryBalance: bigint;
        isPaused: boolean;
        protocolFeeBps: number;
    }>;
    getWithdrawalQueueStats(): Promise<{
        pending: number;
        processing: number;
        completed: number;
        failed: number;
        totalPendingAmount: bigint;
    }>;
    /**
     * Fix #4: Recalculate pending withdrawal amounts after slashing.
     * When slashing reduces total_xlm, the exchange rate drops.
     * Pending withdrawals should reflect the new (lower) exchange rate.
     */
    recalculateWithdrawalQueueAfterSlash(slashAmount: bigint): Promise<void>;
    applySlashing(slashAmountStroops: bigint): Promise<string>;
    pause(): Promise<string>;
    unpause(): Promise<string>;
}
//# sourceMappingURL=index.d.ts.map