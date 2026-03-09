export class UserService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async initialize() {
        console.log("[UserService] Initialized");
    }
    async shutdown() {
        console.log("[UserService] Shut down");
    }
    async getWithdrawalsByWallet(wallet) {
        return this.prisma.withdrawal.findMany({
            where: { wallet },
            orderBy: { createdAt: "desc" },
        });
    }
    async getStakingHistory(wallet) {
        const withdrawals = await this.prisma.withdrawal.findMany({
            where: { wallet },
            orderBy: { createdAt: "desc" },
        });
        return {
            wallet,
            withdrawals,
            totalWithdrawals: withdrawals.length,
            pendingWithdrawals: withdrawals.filter((w) => w.status === "pending").length,
        };
    }
}
//# sourceMappingURL=index.js.map