import dotenv from "dotenv";

dotenv.config();

function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  stellar: {
    rpcUrl: requireEnv("STELLAR_RPC_URL", "https://soroban-testnet.stellar.org"),
    networkPassphrase: requireEnv(
      "STELLAR_NETWORK_PASSPHRASE",
      "Test SDF Network ; September 2015"
    ),
    horizonUrl: requireEnv(
      "STELLAR_HORIZON_URL",
      "https://horizon-testnet.stellar.org"
    ),
  },

  contracts: {
    sxlmTokenContractId: requireEnv(
      "SXLM_TOKEN_CONTRACT_ID",
      "CCSST2JJPO2XX7XKPIEZBVE3YVT3OKVZWVOOCUULQYM2YTXRQYS24DUA"
    ),
    stakingContractId: requireEnv(
      "STAKING_CONTRACT_ID",
      "CBTSQ6AVMK63LXF3BA7WREUGXX2QYYQXKIO7KPZXCEAEAKRVWJS7J7K3"
    ),
    lendingContractId: requireEnv(
      "LENDING_CONTRACT_ID",
      "CBY22XHGAIXFK5RROK4UAFC3BQH5D3ZKA3F2SWURHISB44EXXOYDAHYO"
    ),
    lpPoolContractId: requireEnv(
      "LP_POOL_CONTRACT_ID",
      "CDDYQEF74BJ2D4D4SC5ZVWWFTWRP7APFHSPOLPRT7QIU5H6SGYN6KBIA"
    ),
    governanceContractId: requireEnv(
      "GOVERNANCE_CONTRACT_ID",
      "CDGJP5AYMG2T5D3TZD5LGDO37SOF5LI3SPNOE2UBLLP7ZXANGB52CDS6"
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
    url: requireEnv("REDIS_URL", "redis://localhost:6379"),
  },

  admin: {
    secretKey: requireEnv("ADMIN_SECRET_KEY", ""),
    publicKey: requireEnv("ADMIN_PUBLIC_KEY", ""),
  },

  jwt: {
    secret: requireEnv("JWT_SECRET", "sxlm-dev-jwt-secret-change-in-production"),
    expiresIn: requireEnv("JWT_EXPIRES_IN", "24h"),
  },

  webhooks: {
    governanceUrl: process.env["GOVERNANCE_WEBHOOK_URL"] ?? "",
    slackUrl: process.env["SLACK_WEBHOOK_URL"] ?? "",
  },

  protocol: {
    unbondingPeriodMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    liquidityBufferPercent: 5, // 5% of TVL — fallback minimum
    liquidityBufferSafetyFactor: 2.5, // α in Required Buffer = D × α
    liquidityBufferLookbackDays: 7, // Days to average withdrawal demand
    minStakeAmount: BigInt(10_000_000), // 1 XLM in stroops
    maxStakeAmount: BigInt(100_000_000_000_000), // 10M XLM in stroops
    rebalanceThreshold: 0.1, // 10% deviation triggers rebalance
    validatorMinUptime: 0.95, // 95%
    exchangeRateRefreshIntervalMs: 60_000, // 1 minute
    rewardSnapshotIntervalMs: 5 * 60_000, // 5 minutes
    withdrawalPollIntervalMs: 30_000, // 30 seconds
  },
} as const;

export type Config = typeof config;
