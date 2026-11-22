/**
 * Keeper Bot
 *
 * Runs on a schedule to keep the protocol healthy:
 *
 * Every 6 hours:
 *   1. Harvest accrued lending interest from the lending contract → admin wallet
 *   2. Return it via staking.add_rewards(), which transfers the XLM back into
 *      the vault. The admin wallet is a waypoint, not a destination: if the
 *      funds are not there, step 2 fails rather than lifting the rate anyway.
 *   3. Bump TTL on all 5 contracts so they never expire
 *
 * The reward engine (reward-engine/index.ts) handles simulated APR-based distributions
 * independently. This keeper handles REAL yield from lending fees.
 */
export declare class KeeperBot {
    private server;
    constructor();
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    runHarvestCycle(): Promise<void>;
    private queryLendingAccruedInterest;
    private harvestLendingInterest;
    bumpAllContractTTLs(): Promise<void>;
    private logLpPoolStats;
    recycleTreasury(): Promise<void>;
    private simulateView;
    private executeAdminCall;
    private pollTransaction;
}
//# sourceMappingURL=index.d.ts.map