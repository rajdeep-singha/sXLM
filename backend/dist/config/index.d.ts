export declare const config: {
    readonly stellar: {
        readonly rpcUrl: string;
        readonly networkPassphrase: string;
        readonly horizonUrl: string;
    };
    readonly contracts: {
        readonly sxlmTokenContractId: string;
        readonly stakingContractId: string;
        readonly lendingContractId: string;
        readonly lpPoolContractId: string;
        readonly governanceContractId: string;
    };
    readonly server: {
        readonly port: number;
        readonly host: string;
        readonly nodeEnv: string;
    };
    readonly database: {
        readonly url: string;
    };
    readonly redis: {
        readonly url: string;
    };
    readonly admin: {
        readonly secretKey: string;
        readonly publicKey: string;
    };
    readonly jwt: {
        readonly secret: string;
        readonly expiresIn: string;
    };
    readonly webhooks: {
        readonly governanceUrl: string;
        readonly slackUrl: string;
    };
    readonly protocol: {
        readonly unbondingPeriodMs: number;
        readonly liquidityBufferPercent: 5;
        readonly liquidityBufferSafetyFactor: 2.5;
        readonly liquidityBufferLookbackDays: 7;
        readonly minStakeAmount: bigint;
        readonly maxStakeAmount: bigint;
        readonly rebalanceThreshold: 0.1;
        readonly validatorMinUptime: 0.95;
        readonly exchangeRateRefreshIntervalMs: 60000;
        readonly rewardSnapshotIntervalMs: number;
        readonly withdrawalPollIntervalMs: 30000;
    };
};
export type Config = typeof config;
//# sourceMappingURL=index.d.ts.map