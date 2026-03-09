import { PrismaClient } from "@prisma/client";
export declare class MetricsCron {
    private prisma;
    private lastXlmPrice;
    constructor(prisma: PrismaClient);
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    private fetchXlmPrice;
    private takeMetricsSnapshot;
    getXlmPrice(): number;
}
//# sourceMappingURL=index.d.ts.map