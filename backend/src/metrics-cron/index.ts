import { PrismaClient } from "@prisma/client";
import cron from "node-cron";
import { getTotalStaked, getTotalSupply } from "../vault-engine/contractClient.js";
import { horizonGet } from "../stellar/network.js";

let cronJob: cron.ScheduledTask | null = null;

const XLM_PRICE_API = "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd";

/** Circle USDC on Stellar. The XLM/USDC book is the fallback price source. */
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const DEX_BOOK_PATH =
  "/order_book?selling_asset_type=native&buying_asset_type=credit_alphanum4" +
  `&buying_asset_code=USDC&buying_asset_issuer=${USDC_ISSUER}&limit=1`;

/**
 * USD per XLM from the top of the XLM/USDC order book: the midpoint of best
 * bid and best ask. Null if either side is empty or the spread is too wide to
 * be a price (over 5%).
 */
export function dexMidPrice(book: {
  bids: { price: string }[];
  asks: { price: string }[];
}): number | null {
  const bid = Number(book.bids[0]?.price);
  const ask = Number(book.asks[0]?.price);
  if (!(bid > 0) || !(ask > 0) || ask < bid) return null;
  if ((ask - bid) / ask > 0.05) return null;
  return (bid + ask) / 2;
}

export class MetricsCron {
  private prisma: PrismaClient;
  private lastXlmPrice = 0;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async initialize(): Promise<void> {
    console.log("[MetricsCron] Initializing...");

    // Fetch initial price
    await this.fetchXlmPrice().catch((err) =>
      console.error("[MetricsCron] Initial price fetch failed:", err)
    );

    // Take initial snapshot
    await this.takeMetricsSnapshot().catch((err) =>
      console.error("[MetricsCron] Initial snapshot failed:", err)
    );

    // Schedule: every 5 minutes
    cronJob = cron.schedule("*/5 * * * *", async () => {
      try {
        await this.fetchXlmPrice();
        await this.takeMetricsSnapshot();
      } catch (err) {
        console.error("[MetricsCron] Cron error:", err);
      }
    });

    console.log("[MetricsCron] Initialized, running every 5 min");
  }

  async shutdown(): Promise<void> {
    if (cronJob) {
      cronJob.stop();
      cronJob = null;
    }
    console.log("[MetricsCron] Shut down");
  }

  /**
   * XLM/USD from CoinGecko, falling back to the Stellar DEX order book.
   * CoinGecko rate-limits shared cloud IPs; without a fallback a restart could
   * leave the price at zero and record a TVL of $0.
   */
  private async fetchXlmPrice(): Promise<void> {
    try {
      const response = await fetch(XLM_PRICE_API, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        const data = (await response.json()) as { stellar?: { usd?: number } };
        if (data.stellar?.usd && data.stellar.usd > 0) {
          this.lastXlmPrice = data.stellar.usd;
          console.log(`[MetricsCron] XLM price: $${this.lastXlmPrice} (CoinGecko)`);
          return;
        }
      } else {
        console.warn(`[MetricsCron] CoinGecko returned ${response.status}; trying the Stellar DEX`);
      }
    } catch (err) {
      console.warn("[MetricsCron] CoinGecko unreachable; trying the Stellar DEX:", err);
    }

    try {
      const book = await horizonGet<{ bids: { price: string }[]; asks: { price: string }[] }>(DEX_BOOK_PATH);
      const price = dexMidPrice(book);
      if (price) {
        this.lastXlmPrice = price;
        console.log(`[MetricsCron] XLM price: $${price.toFixed(6)} (Stellar DEX XLM/USDC midpoint)`);
        return;
      }
      console.warn("[MetricsCron] DEX order book gave no usable price");
    } catch (err) {
      console.error("[MetricsCron] DEX price fetch failed:", err);
    }
  }

  /** Last price implied by a stored snapshot, for when both sources fail. */
  private async storedXlmPrice(): Promise<number> {
    const latest = await this.prisma.protocolMetrics.findFirst({
      where: { tvlUsd: { gt: 0 } },
      orderBy: { updatedAt: "desc" },
    });
    if (!latest || latest.totalStaked <= BigInt(0)) return 0;
    return latest.tvlUsd / (Number(latest.totalStaked) / 1e7);
  }

  private async takeMetricsSnapshot(): Promise<void> {
    let totalStaked: bigint;
    let totalSupply: bigint;

    try {
      [totalStaked, totalSupply] = await Promise.all([
        getTotalStaked(),
        getTotalSupply(),
      ]);
    } catch {
      // If contract calls fail, use last known values
      const latest = await this.prisma.protocolMetrics.findFirst({
        orderBy: { updatedAt: "desc" },
      });
      totalStaked = latest?.totalStaked ?? BigInt(0);
      totalSupply = latest?.totalSupply ?? BigInt(0);
    }

    // Calculate TVL in USD: totalStaked (in stroops) / 1e7 * xlmPrice.
    // An unknown price is not a zero price: never record a $0 TVL for it.
    let price = this.lastXlmPrice;
    if (!(price > 0)) {
      price = await this.storedXlmPrice().catch(() => 0);
      if (price > 0) {
        console.warn(`[MetricsCron] Live price unavailable; using last stored price $${price.toFixed(6)}`);
      }
    }
    const totalStakedXlm = Number(totalStaked) / 1e7;
    if (!(price > 0)) {
      console.warn("[MetricsCron] No XLM price available yet; snapshot skipped rather than recording TVL $0");
      return;
    }
    const tvlUsd = totalStakedXlm * price;

    await this.prisma.protocolMetrics.create({
      data: {
        totalStaked,
        totalSupply,
        tvlUsd,
      },
    });

    console.log(
      `[MetricsCron] Snapshot: staked=${totalStakedXlm.toFixed(2)} XLM, TVL=$${tvlUsd.toFixed(2)}`
    );
  }

  getXlmPrice(): number {
    return this.lastXlmPrice;
  }
}
