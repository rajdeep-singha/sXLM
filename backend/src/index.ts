import { PrismaClient } from "@prisma/client";
import { initEventBus, shutdownEventBus } from "./event-bus/index.js";
import { StakingEngine } from "./vault-engine/index.js";
import { RewardEngine } from "./reward-engine/index.js";
import { RiskEngine } from "./risk-engine/index.js";
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
  const riskEngine = new RiskEngine(prisma);
  const eventListener = new EventListenerService(prisma);
  const userService = new UserService(prisma);
  const metricsCron = new MetricsCron(prisma);
  const keeperBot = new KeeperBot();

  // The keeper and risk engine sign with the admin key and act on mainnet: TTL
  // bumps, harvests, and an automatic pause on a solvency shortfall. Running
  // them from a developer machine means a laptop is driving production, so they
  // are opt-in rather than automatic.
  const runAutomation = process.env["RUN_AUTOMATION"] === "true";

  await stakingEngine.initialize();
  await rewardEngine.initialize();
  await eventListener.initialize();
  await userService.initialize();
  await metricsCron.initialize();

  if (runAutomation) {
    await riskEngine.initialize();
    await keeperBot.initialize();
    console.log("[Startup] Automation ON — keeper and risk engine are live");
  } else {
    console.log(
      "[Startup] Automation OFF — keeper and risk engine idle. Set RUN_AUTOMATION=true to enable (production only)."
    );
  }

  // Start API Gateway
  const server = await startApiGateway({
    prisma,
    stakingEngine,
    rewardEngine,
    userService,
  });

  console.log("=== All services running ===");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    await server.close();
    await stakingEngine.shutdown();
    await rewardEngine.shutdown();
    await riskEngine.shutdown();
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
