import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Development seed.
 *
 * This used to insert fifteen invented validators, 155,000 XLM of staked
 * balance, $18,600 of TVL and a 4.5% APY. None of it was real, and figures
 * like that have a way of ending up in screenshots and dashboards.
 *
 * Protocol metrics are now written only by metrics-cron from on-chain reads,
 * and reward snapshots only by reward-engine. There is nothing left that is
 * honest to seed, so this seeds nothing.
 */
async function main() {
  console.log(
    "Nothing to seed — protocol metrics and reward snapshots are derived from chain state."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
