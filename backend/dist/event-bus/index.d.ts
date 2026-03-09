export declare enum EventType {
    STAKE_EXECUTED = "stake:executed",
    UNSTAKE_EXECUTED = "unstake:executed",
    VALIDATOR_DOWN = "validator:down",
    REWARD_UPDATED = "reward:updated",
    WITHDRAWAL_READY = "withdrawal:ready",
    REBALANCE_REQUIRED = "rebalance:required",
    SLASHING_APPLIED = "slashing:applied"
}
export interface StakeExecutedPayload {
    wallet: string;
    xlmAmount: bigint;
    sxlmMinted: bigint;
    txHash: string;
    timestamp: number;
}
export interface ValidatorDownPayload {
    pubkey: string;
    uptime: number;
    lastChecked: string;
}
export interface RewardUpdatedPayload {
    exchangeRate: number;
    apy: number;
    totalStaked: bigint;
    totalSupply: bigint;
    timestamp: number;
}
export interface WithdrawalReadyPayload {
    withdrawalId: number;
    wallet: string;
    amount: bigint;
    claimTxHash: string;
}
export interface UnstakeExecutedPayload {
    wallet: string;
    xlmAmount: bigint;
    sxlmBurned: bigint;
    txHash: string;
    timestamp: number;
}
export interface RebalanceRequiredPayload {
    reason: string;
    validators: Array<{
        pubkey: string;
        currentAllocation: bigint;
        targetAllocation: bigint;
    }>;
    timestamp: number;
}
export interface SlashingAppliedPayload {
    amount: bigint;
    reason: string;
    timestamp: number;
}
type EventPayloadMap = {
    [EventType.STAKE_EXECUTED]: StakeExecutedPayload;
    [EventType.UNSTAKE_EXECUTED]: UnstakeExecutedPayload;
    [EventType.VALIDATOR_DOWN]: ValidatorDownPayload;
    [EventType.REWARD_UPDATED]: RewardUpdatedPayload;
    [EventType.WITHDRAWAL_READY]: WithdrawalReadyPayload;
    [EventType.REBALANCE_REQUIRED]: RebalanceRequiredPayload;
    [EventType.SLASHING_APPLIED]: SlashingAppliedPayload;
};
export declare class EventBus {
    private publisher;
    private subscriber;
    private handlers;
    private isConnected;
    constructor();
    connect(): Promise<void>;
    publish<T extends EventType>(channel: T, data: EventPayloadMap[T]): Promise<number>;
    subscribe<T extends EventType>(channel: T, callback: (data: EventPayloadMap[T]) => void | Promise<void>): Promise<void>;
    unsubscribe(channel: string): Promise<void>;
    disconnect(): Promise<void>;
}
export declare function getEventBus(): EventBus;
export declare function initEventBus(): Promise<void>;
export declare function shutdownEventBus(): Promise<void>;
export {};
//# sourceMappingURL=index.d.ts.map