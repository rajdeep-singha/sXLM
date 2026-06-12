import Fastify from "fastify";
import { StakingEngine } from "../staking-engine/index.js";
import { RewardEngine } from "../reward-engine/index.js";
import { UserService } from "../user-service/index.js";
import { PrismaClient } from "@prisma/client";
export interface GatewayDeps {
    prisma: PrismaClient;
    stakingEngine: StakingEngine;
    rewardEngine: RewardEngine;
    userService: UserService;
}
export declare function startApiGateway(deps: GatewayDeps): Promise<Fastify.FastifyInstance<import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>, import("http").IncomingMessage, import("http").ServerResponse<import("http").IncomingMessage>, Fastify.FastifyBaseLogger, Fastify.FastifyTypeProviderDefault>>;
//# sourceMappingURL=server.d.ts.map