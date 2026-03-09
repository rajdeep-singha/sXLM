import { FastifyPluginAsync } from "fastify";
import { PrismaClient } from "@prisma/client";
import { StakingEngine } from "../../staking-engine/index.js";
export declare const statsRoutes: FastifyPluginAsync<{
    prisma: PrismaClient;
    stakingEngine: StakingEngine;
}>;
//# sourceMappingURL=stats.d.ts.map