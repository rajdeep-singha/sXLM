import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
/**
 * Generate a JWT for a wallet address.
 * Called after wallet signature verification.
 */
export function generateToken(wallet) {
    return jwt.sign({ wallet }, config.jwt.secret, {
        expiresIn: config.jwt.expiresIn,
    });
}
/**
 * Verify a JWT and return the payload.
 */
export function verifyToken(token) {
    return jwt.verify(token, config.jwt.secret);
}
/**
 * Fastify preHandler hook that requires a valid JWT.
 * Attaches `request.wallet` for downstream use.
 */
export async function requireAuth(request, reply) {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        reply.code(401).send({ error: "Missing or invalid Authorization header" });
        return;
    }
    const token = authHeader.slice(7);
    try {
        const payload = verifyToken(token);
        // Attach wallet to request for route handlers
        request.wallet = payload.wallet;
    }
    catch {
        reply.code(401).send({ error: "Invalid or expired token" });
    }
}
//# sourceMappingURL=auth.js.map