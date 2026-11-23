import { PrismaClient } from "@prisma/client";
import { initEventBus, shutdownEventBus } from "./event-bus/index.js";
import { StakingEngine } from "./vault-engine/index.js";
import { RewardEngine } from "./reward-engine/index.js";
import { Monitor } from "./monitor/index.js";
import { networkStatus } from "./stellar/network.js";
import { EventListenerService } from "./event-listener/index.js";
import { UserService } from "./user-service/index.js";
import { MetricsCron } from "./metrics-cron/index.js";
import { KeeperBot } from "./keeper/index.js";
import { startApiGateway } from "./api-gateway/server.js";
import { config } from "./config/index.js";

const prisma = new PrismaClient();

async function main() {
  console.log("=== sXLM Protocol Backend ===");
  console.log(`Environment: ${config.server.nodeEnv}`);
  console.log(`Stellar Network: ${config.stellar.networkPassphrase}`);

  // Connect to database
  await prisma.$connect();
  console.log("[DB] Connected to PostgreSQL");

  // Initialize event bus (Redis)
  await initEventBus();
  console.log("[EventBus] Redis connected");

  // Initialize services
  const stakingEngine = new StakingEngine(prisma);
  const rewardEngine = new RewardEngine(prisma);
  const monitor = new Monitor(prisma);
  const eventListener = new EventListenerService(prisma);
  const userService = new UserService(prisma);
  const metricsCron = new MetricsCron(prisma);
  const keeperBot = new KeeperBot();

  // The keeper and the monitor act on mainnet: TTL bumps, interest settlement
  // and LP fee collection, and production alerts. The keeper signs with its own
  // key, never the admin's; the monitor signs nothing. Running them from a
  // developer machine means a laptop is driving production (and paging
  // people), so they are opt-in rather than automatic.
  const runAutomation = process.env["RUN_AUTOMATION"] === "true";

  await stakingEngine.initialize();
  await rewardEngine.initialize();
  await eventListener.initialize();
  await userService.initialize();
  await metricsCron.initialize();

  if (runAutomation) {
    try {
      await monitor.initialize();
    } catch (err) {
      console.error("[Startup] MONITOR NOT RUNNING:", err);
    }
    try {
      await keeperBot.initialize();
      console.log("[Startup] Automation ON — keeper and monitor are live");
    } catch (err) {
      // A missing or misconfigured keeper key must not take the API down.
      // Contract TTLs carry about 30 days of buffer, so this is loud, not fatal.
      console.error("[Startup] KEEPER NOT RUNNING — fix KEEPER_SECRET_KEY:", err);
    }
  } else {
    console.log(
      "[Startup] Automation OFF — keeper and monitor idle. Set RUN_AUTOMATION=true to enable (production only)."
    );
  }

  // Start API Gateway
  const server = await startApiGateway({
    prisma,
    stakingEngine,
    rewardEngine,
    userService,
    health: () => ({
      automation: runAutomation,
      keeper: keeperBot.status(),
      monitor: monitor.status(),
      endpoints: networkStatus(),
    }),
  });

  console.log("=== All services running ===");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    await server.close();
    await stakingEngine.shutdown();
    await rewardEngine.shutdown();
    await monitor.shutdown();
    await eventListener.shutdown();
    await userService.shutdown();
    await metricsCron.shutdown();
    await keeperBot.shutdown();
    await shutdownEventBus();
    await prisma.$disconnect();
    console.log("Goodbye.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
