import { FastifyPluginAsync } from "fastify";
import { PrismaClient } from "@prisma/client";
import { ValidatorService } from "../../validator-service/index.js";

export const validatorRoutes: FastifyPluginAsync<{
  validatorService: ValidatorService;
  prisma: PrismaClient;
}> = async (
  fastify,
  opts
) => {
  const { validatorService, prisma } = opts;

  /**
   * GET /validators
   * Returns validators matching the frontend Validator interface.
   */
  fastify.get("/validators", async () => {
    try {
      const validators = await validatorService.getValidators();
      return {
        validators: validators.map((v) => ({
          id: String(v.id),
          pubkey: v.pubkey,
          name: v.pubkey.slice(0, 8) + "...",
          uptimePercent: v.uptime * 100,
          commissionPercent: v.commission * 100,
          performanceScore: v.performanceScore * 100,
          allocatedStake: Number(v.allocatedStake) / 1e7,
          isActive: v.uptime >= 0.95,
          lastChecked: v.lastChecked.toISOString(),
        })),
        total: validators.length,
      };
    } catch {
      return { validators: [], total: 0 };
    }
  });

  /**
   * GET /validators/:pubkey/history
   * Returns historical data for a specific validator.
   */
  fastify.get<{ Params: { pubkey: string }; Querystring: { days?: string } }>(
    "/validators/:pubkey/history",
    async (request) => {
      const { pubkey } = request.params;
      const days = parseInt(request.query.days || "30", 10);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const validator = await prisma.validator.findUnique({
        where: { pubkey },
      });

      if (!validator) {
        return { error: "Validator not found", history: [] };
      }

      const history = await prisma.validatorHistory.findMany({
        where: {
          validatorId: validator.id,
          timestamp: { gte: since },
        },
        orderBy: { timestamp: "asc" },
        select: {
          timestamp: true,
          uptime: true,
          commission: true,
          performanceScore: true,
          allocatedStake: true,
        },
      });

      return {
        pubkey,
        history: history.map((h) => ({
          timestamp: h.timestamp.toISOString(),
          uptime: h.uptime * 100,
          commission: h.commission * 100,
          performanceScore: h.performanceScore * 100,
          allocatedStake: Number(h.allocatedStake) / 1e7,
        })),
      };
    }
  );

  /**
   * GET /chart-data
   * Returns historical time-series data for frontend charts.
   * Replaces mock data with real DB data from reward_snapshots and validator_history.
   */
  fastify.get<{ Querystring: { days?: string } }>("/chart-data", async (request) => {
    try {
      const days = parseInt(request.query.days || "90", 10);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const snapshots = await prisma.rewardSnapshot.findMany({
        where: { timestamp: { gte: since } },
        orderBy: { timestamp: "asc" },
        select: { timestamp: true, exchangeRate: true, apy: true, totalStaked: true },
      });

      return {
        apyHistory: snapshots.map((s) => ({ timestamp: s.timestamp.toISOString(), value: s.apy * 100 })),
        exchangeRateHistory: snapshots.map((s) => ({ timestamp: s.timestamp.toISOString(), value: s.exchangeRate })),
        totalStakedHistory: snapshots.map((s) => ({ timestamp: s.timestamp.toISOString(), value: Number(s.totalStaked) / 1e7 })),
        tvlHistory: snapshots.map((s) => ({ timestamp: s.timestamp.toISOString(), value: (Number(s.totalStaked) / 1e7) * 0.12 })),
      };
    } catch {
      return { apyHistory: [], exchangeRateHistory: [], totalStakedHistory: [], tvlHistory: [] };
    }
  });
};
