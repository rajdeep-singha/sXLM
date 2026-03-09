import { FastifyPluginAsync } from "fastify";
import { StakingEngine } from "../../staking-engine/index.js";
/**
 * Admin routes — protected by admin secret key check.
 * These call on-chain admin functions (pause, unpause, slashing).
 */
export declare const adminRoutes: FastifyPluginAsync<{
    stakingEngine: StakingEngine;
}>;
//# sourceMappingURL=admin.d.ts.map