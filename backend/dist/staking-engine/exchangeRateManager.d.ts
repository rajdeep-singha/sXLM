export declare function getCurrentRate(): Promise<number>;
export declare function refreshRate(): Promise<number>;
export declare function getCachedRateInfo(): {
    rate: number;
    fetchedAt: number;
    isStale: boolean;
} | null;
export declare function startPeriodicRefresh(): void;
export declare function stopPeriodicRefresh(): void;
export declare function computeExchangeRate(totalXlmStaked: bigint, totalSxlmSupply: bigint): number;
export declare function xlmToSxlm(xlmStroops: bigint, exchangeRate: number): bigint;
export declare function sxlmToXlm(sxlmStroops: bigint, exchangeRate: number): bigint;
//# sourceMappingURL=exchangeRateManager.d.ts.map