import { FastifyRequest, FastifyReply } from "fastify";
export interface JwtPayload {
    wallet: string;
    iat: number;
    exp: number;
}
/**
 * Generate a JWT for a wallet address.
 * Called after wallet signature verification.
 */
export declare function generateToken(wallet: string): string;
/**
 * Verify a JWT and return the payload.
 */
export declare function verifyToken(token: string): JwtPayload;
/**
 * Fastify preHandler hook that requires a valid JWT.
 * Attaches `request.wallet` for downstream use.
 */
export declare function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void>;
//# sourceMappingURL=auth.d.ts.map