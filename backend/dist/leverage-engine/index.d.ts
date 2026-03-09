/**
 * Leverage Engine — Pure calculation service implementing spec formulas.
 *
 * Leverage = 1 / (1 - c)        where c = collateral factor
 * Net Yield = (Leverage × r) - ((Leverage - 1) × b)
 *   r = staking APR, b = borrow APR
 *
 * Example: c=0.7, r=6%, b=4% → Leverage=3.33x, NetYield=10%
 */
export interface LeverageSimulationInput {
    principal: number;
    loops: number;
    collateralFactor: number;
    stakingAPR: number;
    borrowAPR: number;
}
export interface LeverageLoopDetail {
    loop: number;
    deposited: number;
    borrowed: number;
    totalStaked: number;
    totalBorrowed: number;
}
export interface LeverageSimulationResult {
    maxLeverage: number;
    effectiveLeverage: number;
    totalStaked: number;
    totalBorrowed: number;
    netYieldPercent: number;
    grossYield: number;
    borrowCost: number;
    netYield: number;
    loops: LeverageLoopDetail[];
}
export interface OptimalLeverageResult {
    collateralFactor: number;
    maxLeverage: number;
    optimalLoops: number;
    stakingAPR: number;
    borrowAPR: number;
    netYieldPercent: number;
}
export declare class LeverageEngine {
    /**
     * Simulate N loops of leveraged staking.
     */
    simulate(input: LeverageSimulationInput): LeverageSimulationResult;
    /**
     * Calculate optimal leverage for given rates.
     */
    optimal(stakingAPR?: number, borrowAPR?: number, collateralFactor?: number): OptimalLeverageResult;
}
//# sourceMappingURL=index.d.ts.map