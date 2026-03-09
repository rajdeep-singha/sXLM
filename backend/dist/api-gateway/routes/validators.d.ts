import { FastifyPluginAsync } from "fastify";
import { PrismaClient } from "@prisma/client";
import { ValidatorService } from "../../validator-service/index.js";
export declare const validatorRoutes: FastifyPluginAsync<{
    validatorService: ValidatorService;
    prisma: PrismaClient;
}>;
//# sourceMappingURL=validators.d.ts.map