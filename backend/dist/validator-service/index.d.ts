import { PrismaClient } from "@prisma/client";
export declare class ValidatorService {
    private prisma;
    private horizonUrl;
    constructor(prisma: PrismaClient);
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    fetchAndUpdateValidators(): Promise<void>;
    private fetchValidatorsFromHorizon;
    private fetchKnownValidators;
    private calculateMetrics;
    private computePerformanceScore;
    getValidators(): Promise<Array<{
        id: number;
        pubkey: string;
        uptime: number;
        commission: number;
        votingPower: number | null;
        performanceScore: number;
        allocatedStake: bigint;
        lastChecked: Date;
    }>>;
    getValidatorByPubkey(pubkey: string): Promise<{
        id: number;
        pubkey: string;
        uptime: number;
        commission: number;
        votingPower: number | null;
        performanceScore: number;
        allocatedStake: bigint;
        lastChecked: Date;
    } | null>;
}
//# sourceMappingURL=index.d.ts.map