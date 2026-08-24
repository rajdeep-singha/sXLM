import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { config } from "../../config/index.js";
import { StakingEngine } from "../../vault-engine/index.js";

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

  // POST /admin/slash removed with apply_slashing. Losses will be reported
  // against a named strategy once the registry exists; until then there is no
  // honest way for an admin to lower the exchange rate.

};
