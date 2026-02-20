export const NETWORK = {
  name: import.meta.env.VITE_NETWORK_NAME || 'TESTNET',
  networkPassphrase: import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
  horizonUrl: import.meta.env.VITE_HORIZON_URL || 'https://horizon-testnet.stellar.org',
  sorobanRpcUrl: import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
  friendbotUrl: 'https://friendbot.stellar.org',
} as const;

export const CONTRACTS = {
  sxlmToken: import.meta.env.VITE_SXLM_TOKEN_CONTRACT_ID || 'CCSST2JJPO2XX7XKPIEZBVE3YVT3OKVZWVOOCUULQYM2YTXRQYS24DUA',
  staking: import.meta.env.VITE_STAKING_CONTRACT_ID || 'CBTSQ6AVMK63LXF3BA7WREUGXX2QYYQXKIO7KPZXCEAEAKRVWJS7J7K3',
  lending: import.meta.env.VITE_LENDING_CONTRACT_ID || 'CBY22XHGAIXFK5RROK4UAFC3BQH5D3ZKA3F2SWURHISB44EXXOYDAHYO',
  lpPool: import.meta.env.VITE_LP_POOL_CONTRACT_ID || 'CDDYQEF74BJ2D4D4SC5ZVWWFTWRP7APFHSPOLPRT7QIU5H6SGYN6KBIA',
  governance: import.meta.env.VITE_GOVERNANCE_CONTRACT_ID || 'CDGJP5AYMG2T5D3TZD5LGDO37SOF5LI3SPNOE2UBLLP7ZXANGB52CDS6',
} as const;

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const PROTOCOL_CONFIG = {
  minStakeAmount: 1,
  maxStakeAmount: 1_000_000,
  unbondingPeriodDays: 21,
  instantWithdrawFeePercent: 0.5,
  decimals: 7,
  xlmDecimals: 7,
  tokenSymbol: 'sXLM',
  nativeSymbol: 'XLM',
} as const;
