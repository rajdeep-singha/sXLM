import { PrismaClient } from "@prisma/client";

/**
 * Withdrawal counts from the database, for the stats API.
 *
 * There is no backend claim processor. Claiming needs the withdrawing user's
 * own signature (`claim_withdrawal` calls `user.require_auth()`), so the
 * service cannot claim for anyone; users claim from the app.
 */
export async function getQueueStats(
  prisma: PrismaClient
): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  totalPendingAmount: bigint;
}> {
  const [pending, processing, completed, failed] = await Promise.all([
    prisma.withdrawal.count({ where: { status: "pending" } }),
    prisma.withdrawal.count({ where: { status: "processing" } }),
    prisma.withdrawal.count({ where: { status: "completed" } }),
    prisma.withdrawal.count({ where: { status: "failed" } }),
  ]);

  const pendingAgg = await prisma.withdrawal.aggregate({
    where: { status: "pending" },
    _sum: { amount: true },
  });

  return {
    pending,
    processing,
    completed,
    failed,
    totalPendingAmount: pendingAgg._sum.amount ?? BigInt(0),
  };
}
