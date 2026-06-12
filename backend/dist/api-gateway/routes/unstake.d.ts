import { FastifyPluginAsync } from "fastify";
import { PrismaClient } from "@prisma/client";
import { StakingEngine } from "../../staking-engine/index.js";
export declare const unstakeRoutes: FastifyPluginAsync<{
    stakingEngine: StakingEngine;
    prisma?: PrismaClient;
}>;
//# sourceMappingURL=unstake.d.ts.map