import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { UserService } from "../../user-service/index.js";

const walletParamSchema = z.object({
  wallet: z.string().min(56).max(56),
});

export const withdrawalRoutes: FastifyPluginAsync<{ userService: UserService }> = async (
  fastify,
  opts
) => {
  const { userService } = opts;

  /**
   * GET /staking/withdrawals/:wallet
   * Get all withdrawals for a wallet address.
   */
  fastify.get("/staking/withdrawals/:wallet", async (request, reply) => {
    try {
      const params = walletParamSchema.parse(request.params);
      const withdrawals = await userService.getWithdrawalsByWallet(params.wallet);

      return {
        withdrawals: withdrawals.map((w) => ({
          id: String(w.id),
          wallet: w.wallet,
          amount: w.amount.toString(),
          status: w.status,
          unlockTime: w.unlockTime.toISOString(),
          createdAt: w.createdAt.toISOString(),
        })),
        total: withdrawals.length,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch withdrawals";
      reply.status(400).send({ error: message });
    }
  });

  /**
   * GET /withdrawals (query param version — backwards compat)
   */
  fastify.get("/withdrawals", async (request, reply) => {
    try {
      const query = z
        .object({ wallet: z.string().min(56).max(56) })
        .parse(request.query);
      const withdrawals = await userService.getWithdrawalsByWallet(query.wallet);

      return {
        withdrawals: withdrawals.map((w) => ({
          id: String(w.id),
          wallet: w.wallet,
          amount: w.amount.toString(),
          status: w.status,
          unlockTime: w.unlockTime.toISOString(),
          createdAt: w.createdAt.toISOString(),
        })),
        total: withdrawals.length,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid query";
      reply.status(400).send({ error: message });
    }
  });
};
