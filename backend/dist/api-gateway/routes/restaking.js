import { z } from "zod";
import { RestakingEngine } from "../../restaking-engine/index.js";
const simulateSchema = z.object({
    principal: z.number().positive(),
    loops: z.number().int().min(1).max(20),
    collateralFactor: z.number().min(0.1).max(0.95).optional().default(0.7),
    stakingAPR: z.number().min(0).max(1).optional().default(0),
    borrowAPR: z.number().min(0).max(1).optional().default(0.04),
});
export const restakingRoutes = async (fastify, opts) => {
    const { prisma } = opts;
    const engine = new RestakingEngine(prisma);
    /**
     * POST /restaking/simulate
     * Simulate N restaking loops.
     */
    fastify.post("/restaking/simulate", async (request, reply) => {
        try {
            const body = simulateSchema.parse(request.body);
            const result = engine.simulate(body.principal, body.loops, body.collateralFactor, body.stakingAPR, body.borrowAPR);
            return result;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Simulation failed";
            reply.status(400).send({ error: message });
        }
    });
    /**
     * GET /restaking/position/:wallet
     * Get user's restaking position from on-chain data.
     */
    fastify.get("/restaking/position/:wallet", async (request) => {
        const { wallet } = request.params;
        const position = await engine.getPosition(wallet);
        return position;
    });
};
//# sourceMappingURL=restaking.js.map