import dotenv from "dotenv";

if (process.env["NODE_ENV"] !== "production") {
  dotenv.config();
}

function numberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${key} must be a positive number, got "${raw}"`);
  }
  return n;
}

function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Ordered endpoint list: a comma-separated `<name>S` variable wins; otherwise
 * the single `<name>` variable (kept for existing deployments) comes first and
 * the defaults follow as fallbacks. Duplicates are dropped.
 */
function endpointList(listVar: string, singleVar: string, defaults: string[]): string[] {
  const list = process.env[listVar];
  const urls = list
    ? list.split(",")
    : [process.env[singleVar] ?? "", ...defaults];
  return [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
}

// Mainnet defaults, checked healthy on 2026-11-24. A paid provider goes first
// in STELLAR_RPC_URLS once contracted; these remain as fallbacks.
const DEFAULT_RPC_URLS = [
  "https://mainnet.sorobanrpc.com",
  "https://soroban-rpc.mainnet.stellar.gateway.fm",
  "https://rpc.lightsail.network",
];
const DEFAULT_HORIZON_URLS = ["https://horizon.stellar.org", "https://horizon.stellar.lobstr.co"];

const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";
const networkPassphrase = requireEnv("STELLAR_NETWORK_PASSPHRASE", MAINNET_PASSPHRASE);
// Mainnet endpoints are only ever fallbacks for a mainnet configuration. A
// testnet deployment uses exactly the endpoints it names.
const onMainnet = networkPassphrase === MAINNET_PASSPHRASE;

const rpcUrls = endpointList("STELLAR_RPC_URLS", "STELLAR_RPC_URL", onMainnet ? DEFAULT_RPC_URLS : []);
const horizonUrls = endpointList(
  "STELLAR_HORIZON_URLS",
  "STELLAR_HORIZON_URL",
  onMainnet ? DEFAULT_HORIZON_URLS : []
);
if (rpcUrls.length === 0 || horizonUrls.length === 0) {
  throw new Error("Set STELLAR_RPC_URL(S) and STELLAR_HORIZON_URL(S) for a non-mainnet network");
}

export const config = {
  stellar: {
    /** Primary RPC endpoint. Use `rpcUrls` (through stellar/network.ts) for calls. */
    rpcUrl: rpcUrls[0]!,
    rpcUrls,
    networkPassphrase,
    /** Primary Horizon endpoint. Use `horizonUrls` (through stellar/network.ts) for calls. */
    horizonUrl: horizonUrls[0]!,
    horizonUrls,
  },

  contracts: {
    sxlmTokenContractId: requireEnv(
      "SXLM_TOKEN_CONTRACT_ID",
      "CCGFHMW3NZD5Z7ATHYHZSEG6ABCJADUHP5HIAWFPR37CP4VGNEDQO7FJ"
    ),
    stakingContractId: requireEnv(
      "STAKING_CONTRACT_ID",
      "CDYXKWVDGEVA6OSIGN7GRAPPRN6AKID35OJL5ZZQIBCMECZ35KGL45PS"
    ),
    lendingContractId: requireEnv(
      "LENDING_CONTRACT_ID",
      "CAOWXZ6BWA2ZYY7GHD75OFKADKUJS4WCKPDYGGXULQWFJRB55TXAQNJG"
    ),
    lpPoolContractId: requireEnv(
      "LP_POOL_CONTRACT_ID",
      "CAW2DRMOI3CCJWKVMEUWYJUEQHXB4S4DR72HNL2DWQCMQQUH3LFFVLHV"
    ),
    governanceContractId: requireEnv(
      "GOVERNANCE_CONTRACT_ID",
      "CB7LV3FBQ7US26GVC7SM7RMX22IEEHAEUL7V3TDDWM32DHA5TDFDDEP4"
    ),
  },

  server: {
    port: parseInt(requireEnv("PORT", "3001"), 10),
    host: requireEnv("HOST", "0.0.0.0"),
    nodeEnv: requireEnv("NODE_ENV", "development"),
  },

  database: {
    url: requireEnv(
      "DATABASE_URL",
      "postgresql://sxlm:sxlm_password@localhost:5432/sxlm_protocol"
    ),
  },

  redis: {
    enabled: process.env["EVENT_BUS_DRIVER"] === "redis",
    url: process.env["REDIS_URL"] ?? "",
  },

  // The contract admin. Only its address is configured: admin actions are
  // signed offline by the multisig signers, never by this service.
  // The address also serves as the source account for read-only simulations.
  admin: {
    publicKey: requireEnv("ADMIN_PUBLIC_KEY", "GDWXTIIROGCVBSNQMBJFH6HOWQ4YSRVMKSUS53CH6MP56WSWD6J4VZ5N"),
  },

  // The keeper signs permissionless upkeep only: TTL bumps, interest
  // settlement, LP fee collection. It must not be a signer on the admin account.
  keeper: {
    secretKey: requireEnv("KEEPER_SECRET_KEY", ""),
  },

  jwt: {
    secret: requireEnv("JWT_SECRET", "sxlm-dev-jwt-secret-change-in-production"),
    expiresIn: requireEnv("JWT_EXPIRES_IN", "24h"),
  },

  webhooks: {
    governanceUrl: process.env["GOVERNANCE_WEBHOOK_URL"] ?? "",
    slackUrl: process.env["SLACK_WEBHOOK_URL"] ?? "",
    /** JSON alert destination. Falls back to the governance webhook. */
    alertUrl: process.env["ALERT_WEBHOOK_URL"] ?? process.env["GOVERNANCE_WEBHOOK_URL"] ?? "",
  },

  /** Production alerts (monitor/). Thresholds can be tightened per deployment. */
  monitor: {
    intervalMs: numberEnv("MONITOR_INTERVAL_MINUTES", 5) * 60_000,
    reminderMs: numberEnv("ALERT_REMINDER_HOURS", 24) * 3_600_000,
    ttlMinDays: numberEnv("ALERT_TTL_MIN_DAYS", 7),
    keeperSilenceHours: numberEnv("ALERT_KEEPER_SILENCE_HOURS", 12),
    keeperMinXlm: numberEnv("ALERT_KEEPER_MIN_XLM", 2),
    utilisationBps: numberEnv("ALERT_UTILISATION_BPS", 8_500),
    withdrawalStaleDays: numberEnv("ALERT_WITHDRAWAL_STALE_DAYS", 30),
    /**
     * Keeper address to watch. Derived from KEEPER_SECRET_KEY when unset, so a
     * monitor-only deployment can watch the keeper without holding its key.
     */
    keeperPublicKey: process.env["KEEPER_PUBLIC_KEY"] ?? "",
  },

  protocol: {
    unbondingPeriodMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    liquidityBufferPercent: 5, // 5% of TVL — fallback minimum
    liquidityBufferSafetyFactor: 2.5, // α in Required Buffer = D × α
    liquidityBufferLookbackDays: 7, // Days to average withdrawal demand
    minStakeAmount: BigInt(10_000_000), // 1 XLM in stroops
    maxStakeAmount: BigInt(100_000_000_000_000), // 10M XLM in stroops
    rebalanceThreshold: 0.1, // 10% deviation triggers rebalance
    exchangeRateRefreshIntervalMs: 60_000, // 1 minute
    rewardSnapshotIntervalMs: 5 * 60_000, // 5 minutes
    withdrawalPollIntervalMs: 30_000, // 30 seconds
  },
} as const;

export type Config = typeof config;
