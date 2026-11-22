import { PrismaClient } from "@prisma/client";
/**
 * Risk Engine
 *
 * Watches the one invariant the protocol documentation actually commits to:
 *
 *   total assets >= redeemable liabilities, unless a loss event is declared
 *
 * Strategy exposure and collateral concentration are not monitored; they need
 * the strategy registry before they can be measured.
 */
export declare class RiskEngine {
    private prisma;
    private emergencyMode;
    private interval;
    constructor(prisma: PrismaClient);
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    /**
     * Compare what the vault holds against everything it owes.
     *
     * Share claims are `total_assets`, which the contract already derives net of
     * queued withdrawals and accrued fees. A shortfall against the raw balance
     * means the contract is promising XLM it does not hold.
     */
    private runSolvencyCheck;
    private notify;
    isEmergencyMode(): boolean;
}
//# sourceMappingURL=index.d.ts.map