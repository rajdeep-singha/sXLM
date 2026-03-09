import { PrismaClient } from "@prisma/client";
export declare function startWithdrawalQueueProcessor(prisma: PrismaClient): void;
export declare function stopWithdrawalQueueProcessor(): void;
export declare function getQueueStats(prisma: PrismaClient): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    totalPendingAmount: bigint;
}>;
//# sourceMappingURL=withdrawalQueueProcessor.d.ts.map