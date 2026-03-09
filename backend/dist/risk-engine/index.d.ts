import { PrismaClient } from "@prisma/client";
export declare class RiskEngine {
    private prisma;
    private emergencyMode;
    constructor(prisma: PrismaClient);
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    private runHealthCheck;
    /**
     * Check if validator allocations deviate too far from their target (weighted by performance).
     */
    private checkAllocationDeviation;
    /**
     * Execute auto-reallocation: move stake from underperforming validators to healthy ones.
     */
    private executeAutoReallocation;
    private handleValidatorDown;
    /**
     * Send notification to governance/monitoring webhooks.
     */
    private sendGovernanceNotification;
    isEmergencyMode(): boolean;
}
//# sourceMappingURL=index.d.ts.map