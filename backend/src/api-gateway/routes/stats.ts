import { FastifyPluginAsync } from "fastify";
import { PrismaClient } from "@prisma/client";
import { StakingEngine } from "../../staking-engine/index.js";

export const statsRoutes: FastifyPluginAsync<{
  prisma: PrismaClient;
  stakingEngine: StakingEngine;
}> = async (fastify, opts) => {
  const { prisma, stakingEngine } = opts;

  /**
   * GET /protocol-stats
   * Returns protocol metrics matching the frontend ProtocolStats interface.
   */
  fastify.get("/protocol-stats", async () => {
    try {
      const [metrics, protocolStats, validatorCount] = await Promise.all([
        prisma.protocolMetrics.findFirst({ orderBy: { updatedAt: "desc" } }),
        stakingEngine.getProtocolStats(),
        prisma.validator.count(),
      ]);

      const totalStakedXlm = Number(protocolStats.totalStaked) / 1e7;
      const totalSxlmSupply = Number(protocolStats.totalSupply) / 1e7;

      return {
        totalStaked: totalStakedXlm,
        totalSxlmSupply,
        exchangeRate: protocolStats.exchangeRate,
        tvlUsd: metrics?.tvlUsd ?? 0,
        totalStakers: 0,
        totalValidators: validatorCount,
        xlmPrice: metrics?.tvlUsd && totalStakedXlm > 0
          ? metrics.tvlUsd / totalStakedXlm
          : 0.12,
        liquidityBuffer: Number(protocolStats.liquidityBuffer) / 1e7,
        avgValidatorScore: metrics?.avgValidatorScore ?? 0,
        treasuryBalance: Number(protocolStats.treasuryBalance) / 1e7,
        isPaused: protocolStats.isPaused,
        protocolFeePct: protocolStats.protocolFeeBps / 100,
      };
    } catch {
      return {
        totalStaked: 0,
        totalSxlmSupply: 0,
        exchangeRate: 1,
        tvlUsd: 0,
        totalStakers: 0,
        totalValidators: 0,
        xlmPrice: 0.12,
        liquidityBuffer: 0,
        avgValidatorScore: 0,
        treasuryBalance: 0,
        isPaused: false,
        protocolFeePct: 10,
      };
    }
  });
};
