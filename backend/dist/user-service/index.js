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
            where: { wallet, status: { not: "claimed" } },
            orderBy: { createdAt: "desc" },
        });
    }
    async markWithdrawalClaimed(wallet, withdrawalId) {
        await this.prisma.withdrawal.updateMany({
            where: { id: withdrawalId, wallet },
            data: { status: "claimed" },
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