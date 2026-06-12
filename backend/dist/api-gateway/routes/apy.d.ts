import { FastifyPluginAsync } from "fastify";
import { RewardEngine } from "../../reward-engine/index.js";
import { StakingEngine } from "../../staking-engine/index.js";
export declare const apyRoutes: FastifyPluginAsync<{
    rewardEngine: RewardEngine;
    stakingEngine?: StakingEngine;
}>;
//# sourceMappingURL=apy.d.ts.map