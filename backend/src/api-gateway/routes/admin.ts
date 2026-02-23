import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { config } from "../../config/index.js";
import { StakingEngine } from "../../staking-engine/index.js";

/**
 * Admin routes — protected by admin secret key check.
 * These call on-chain admin functions (pause, unpause, slashing).
 */
export const adminRoutes: FastifyPluginAsync<{ stakingEngine: StakingEngine }> = async (
  fastify,
  opts
) => {
  const { stakingEngine } = opts;

  // Simple admin auth: require X-Admin-Key header matching the admin public key
  fastify.addHook("preHandler", async (request, reply) => {
    const adminKey = request.headers["x-admin-key"];
    if (adminKey !== config.admin.publicKey) {
      reply.status(403).send({ error: "Unauthorized — admin key required" });
    }
  });

  /**
   * POST /admin/pause
   * Pause the protocol on-chain — blocks all deposits & withdrawals.
   */
  fastify.post("/admin/pause", async (_request, reply) => {
    try {
      const txHash = await stakingEngine.pause();
      return { success: true, txHash, message: "Protocol paused" };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Pause failed";
      reply.status(500).send({ error: message });
    }
  });

  /**
   * POST /admin/unpause
   * Unpause the protocol on-chain — resumes normal operation.
   */
  fastify.post("/admin/unpause", async (_request, reply) => {
    try {
      const txHash = await stakingEngine.unpause();
      return { success: true, txHash, message: "Protocol unpaused" };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unpause failed";
      reply.status(500).send({ error: message });
    }
  });

  /**
   * POST /admin/slash
   * Apply slashing on-chain — reduces TotalXlmStaked, lowering exchange rate.
   */
  fastify.post("/admin/slash", async (request, reply) => {
    try {
      const body = z.object({
        amountXlm: z.number().positive(),
        reason: z.string().optional(),
      }).parse(request.body);

      const slashStroops = BigInt(Math.floor(body.amountXlm * 1e7));
      const txHash = await stakingEngine.applySlashing(slashStroops);

      return {
        success: true,
        txHash,
        slashedXlm: body.amountXlm,
        reason: body.reason ?? "manual",
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Slash failed";
      reply.status(500).send({ error: message });
    }
  });
};
