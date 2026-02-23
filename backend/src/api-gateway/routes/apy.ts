import { FastifyPluginAsync } from "fastify";
import { RewardEngine } from "../../reward-engine/index.js";

export const apyRoutes: FastifyPluginAsync<{ rewardEngine: RewardEngine }> = async (
  fastify,
  opts
) => {
  const { rewardEngine } = opts;

  /**
   * GET /apy
   * Returns APY/APR data matching the frontend APYData interface.
   *
   * APR = validator-weighted net APR the engine actually distributes
   *       = Σ(w_i × 6% × (1 - commission_i))
   *
   * APY = APR compounded at the distribution frequency (every 6h = 1460×/year)
   *       = (1 + APR/1460)^1460 - 1
   *
   * The exchange-rate-derived APY is only shown when there is ≥7 days of
   * snapshot history AND it is within 3× of the expected APY.  Otherwise we
   * fall back to the distribution-rate APY so users always see a realistic number.
   */
  fastify.get("/apy", async () => {
    try {
    // Periods per year at 6-hour distribution cadence
    const PERIODS_PER_YEAR = (365 * 24 * 60 * 60 * 1000) / (6 * 60 * 60 * 1000); // 1460

    // Current weighted APR from validator commissions
    const weightedAPR = await rewardEngine.getWeightedAPR();

    // Expected APY from the actual reward distribution rate
    const expectedAPY = Math.pow(1 + weightedAPR / PERIODS_PER_YEAR, PERIODS_PER_YEAR) - 1;

    const snapshot = await rewardEngine.getLatestSnapshot();

    if (!snapshot) {
      return {
        currentApr: weightedAPR * 100,
        currentApy: expectedAPY * 100,
        apy7d: 0,
        apy30d: 0,
        apy90d: expectedAPY * 100,
        exchangeRate: 1.0,
        totalStaked: "0",
        totalSupply: "0",
        timestamp: new Date().toISOString(),
      };
    }

    // Only trust the exchange-rate-derived APY when it is plausible
    // (within 3× of the expected APY from our distribution rate).
    // During testnet bootstrap the exchange rate can jump artificially,
    // producing nonsensical annualized values (e.g. 302%).
    const derivedAPY = snapshot.apy;
    const displayAPY =
      derivedAPY > 0 && derivedAPY <= expectedAPY * 3
        ? derivedAPY
        : expectedAPY;

    return {
      currentApr: weightedAPR * 100,
      currentApy: displayAPY * 100,
      apy7d: snapshot.yield7d <= expectedAPY * 3 ? snapshot.yield7d * 100 : expectedAPY * 100,
      apy30d: snapshot.yield30d <= expectedAPY * 3 ? snapshot.yield30d * 100 : expectedAPY * 100,
      apy90d: displayAPY * 100,
      exchangeRate: snapshot.exchangeRate,
      totalStaked: snapshot.totalStaked.toString(),
      totalSupply: snapshot.totalSupply.toString(),
      timestamp: snapshot.timestamp.toISOString(),
    };
    } catch {
      return {
        currentApr: 0, currentApy: 0, apy7d: 0, apy30d: 0, apy90d: 0,
        exchangeRate: 1, totalStaked: "0", totalSupply: "0",
        timestamp: new Date().toISOString(),
      };
    }
  });
};
