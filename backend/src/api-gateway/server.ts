import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { config } from "../config/index.js";
import { StakingEngine } from "../staking-engine/index.js";
import { ValidatorService } from "../validator-service/index.js";
import { RewardEngine } from "../reward-engine/index.js";
import { UserService } from "../user-service/index.js";
import { PrismaClient } from "@prisma/client";
import { stakeRoutes } from "./routes/stake.js";
import { unstakeRoutes } from "./routes/unstake.js";
import { submitRoutes } from "./routes/submit.js";
import { validatorRoutes } from "./routes/validators.js";
import { statsRoutes } from "./routes/stats.js";
import { apyRoutes } from "./routes/apy.js";
import { withdrawalRoutes } from "./routes/withdrawals.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { leverageRoutes } from "./routes/leverage.js";
import { restakingRoutes } from "./routes/restaking.js";
import { lendingRoutes } from "./routes/lending.js";
import { liquidityRoutes } from "./routes/liquidity.js";
import { governanceRoutes } from "./routes/governance.js";

export interface GatewayDeps {
  prisma: PrismaClient;
  stakingEngine: StakingEngine;
  validatorService: ValidatorService;
  rewardEngine: RewardEngine;
  userService: UserService;
}

export async function startApiGateway(deps: GatewayDeps) {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, { origin: true });
  await fastify.register(rateLimit, {
    max: 500,
    timeWindow: "1 minute",
  });

  // Decorate request with wallet field for auth
  fastify.decorateRequest("wallet", "");

  // Health check
  fastify.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  // Auth routes (public)
  await fastify.register(authRoutes, { prefix: "/api" });

  // Public read-only routes
  await fastify.register(validatorRoutes, {
    validatorService: deps.validatorService,
    prisma: deps.prisma,
    prefix: "/api",
  });
  await fastify.register(statsRoutes, {
    prisma: deps.prisma,
    stakingEngine: deps.stakingEngine,
    prefix: "/api",
  });
  await fastify.register(apyRoutes, {
    rewardEngine: deps.rewardEngine,
    prefix: "/api",
  });

  // Transaction routes (public — wallet signature is the auth)
  await fastify.register(stakeRoutes, {
    stakingEngine: deps.stakingEngine,
    prefix: "/api",
  });
  await fastify.register(unstakeRoutes, {
    stakingEngine: deps.stakingEngine,
    prisma: deps.prisma,
    prefix: "/api",
  });
  await fastify.register(submitRoutes, {
    stakingEngine: deps.stakingEngine,
    prefix: "/api",
  });

  // Withdrawal query routes (public — read-only by wallet address)
  await fastify.register(withdrawalRoutes, {
    userService: deps.userService,
    prefix: "/api",
  });

  // Admin routes (protected by X-Admin-Key header)
  await fastify.register(adminRoutes, {
    stakingEngine: deps.stakingEngine,
    prefix: "/api",
  });

  // Milestone 5: Leverage, Restaking, Lending, Liquidity, Governance
  await fastify.register(leverageRoutes, { prefix: "/api" });
  await fastify.register(restakingRoutes, {
    prisma: deps.prisma,
    prefix: "/api",
  });
  await fastify.register(lendingRoutes, {
    prisma: deps.prisma,
    prefix: "/api",
  });
  await fastify.register(liquidityRoutes, {
    prisma: deps.prisma,
    prefix: "/api",
  });
  await fastify.register(governanceRoutes, {
    prisma: deps.prisma,
    prefix: "/api",
  });

  await fastify.listen({ port: config.server.port, host: "0.0.0.0" });
  console.log(`[API Gateway] Listening on port ${config.server.port}`);

  return fastify;
}
