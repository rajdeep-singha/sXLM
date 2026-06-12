import { PrismaClient } from "@prisma/client";
export declare class UserService {
    private prisma;
    constructor(prisma: PrismaClient);
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    getWithdrawalsByWallet(wallet: string): Promise<{
        id: number;
        unlockTime: Date;
        wallet: string;
        amount: bigint;
        status: string;
        createdAt: Date;
    }[]>;
    markWithdrawalClaimed(wallet: string, withdrawalId: number): Promise<void>;
    getStakingHistory(wallet: string): Promise<{
        wallet: string;
        withdrawals: {
            id: number;
            unlockTime: Date;
            wallet: string;
            amount: bigint;
            status: string;
            createdAt: Date;
        }[];
        totalWithdrawals: number;
        pendingWithdrawals: number;
    }>;
}
//# sourceMappingURL=index.d.ts.map