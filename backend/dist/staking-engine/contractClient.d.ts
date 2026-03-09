export interface DepositResult {
    txHash: string;
    sxlmMinted: bigint;
    exchangeRate: number;
}
export interface WithdrawalRequestResult {
    txHash: string;
    withdrawalId: number;
    unlockTime: Date;
    isInstant: boolean;
    xlmAmount: bigint;
}
export interface ClaimResult {
    txHash: string;
    xlmReturned: bigint;
}
export declare function callDeposit(userPublicKey: string, xlmAmount: bigint): Promise<DepositResult>;
export declare function callRequestWithdrawal(userPublicKey: string, sxlmAmount: bigint): Promise<WithdrawalRequestResult>;
export declare function callClaimWithdrawal(userPublicKey: string, withdrawalId: number): Promise<ClaimResult>;
export declare function getExchangeRate(): Promise<number>;
export declare function getTotalStaked(): Promise<bigint>;
export declare function getTotalSupply(): Promise<bigint>;
export declare function getLiquidityBuffer(): Promise<bigint>;
export declare function getTreasuryBalance(): Promise<bigint>;
export declare function getIsPaused(): Promise<boolean>;
export declare function getProtocolFeeBps(): Promise<number>;
export declare function callAddRewards(amount: bigint): Promise<string>;
export declare function callRecalibrateRate(): Promise<string>;
export declare function callApplySlashing(slashAmount: bigint): Promise<string>;
export declare function callPause(): Promise<string>;
export declare function callUnpause(): Promise<string>;
/**
 * Sync the staking exchange rate to the lending contract.
 * The lending contract stores its own ExchangeRate (sXLM→XLM, scaled by 1e7).
 * Call this after every reward distribution or snapshot to keep health factors current.
 *
 * rate: exchange rate from computeExchangeRate() (e.g. 1.0042)
 * The lending contract expects RATE_PRECISION = 1e7 scaling, so 1.0042 → 10_042_000
 */
export declare function callUpdateLendingExchangeRate(rate: number): Promise<void>;
//# sourceMappingURL=contractClient.d.ts.map