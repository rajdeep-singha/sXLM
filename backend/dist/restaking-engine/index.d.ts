/**
 * Restaking Engine — Automated restaking loop simulation and position tracking.
 *
 * Flow: stake → deposit as collateral → borrow → restake (repeat N times)
 *
 * Uses on-chain data from lending and staking contracts for real position tracking.
 */
import { PrismaClient } from "@prisma/client";
export interface RestakingLoopStep {
    step: number;
    action: string;
    amount: number;
    totalStaked: number;
    totalBorrowed: number;
    healthFactor: number;
}
export interface RestakingSimulationResult {
    initialDeposit: number;
    loops: number;
    totalStaked: number;
    totalBorrowed: number;
    effectiveLeverage: number;
    estimatedNetAPR: number;
    healthFactor: number;
    steps: RestakingLoopStep[];
}
export interface RestakingPosition {
    wallet: string;
    totalStaked: number;
    totalBorrowed: number;
    effectiveLeverage: number;
    healthFactor: number;
    netAPR: number;
    loops: number;
}
export declare class RestakingEngine {
    private prisma;
    constructor(prisma: PrismaClient);
    /**
     * Simulate N restaking loops with real math.
     */
    simulate(principal: number, loops: number, collateralFactor?: number, stakingAPR?: number, borrowAPR?: number): RestakingSimulationResult;
    /**
     * Get a user's restaking position by combining staking + lending data.
     */
    getPosition(wallet: string): Promise<RestakingPosition>;
    private getPositionFromDB;
}
//# sourceMappingURL=index.d.ts.map