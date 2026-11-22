import {
  rpc,
  Contract,
  Address,
  xdr,
  nativeToScVal,
  scValToNative,
  Keypair,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Operation,
} from "@stellar/stellar-sdk";
import { config } from "../config/index.js";
import { loadKeeperKeypair } from "../keeper/keys.js";

const server = new rpc.Server(config.stellar.rpcUrl);

function getStakingContract(): Contract {
  return new Contract(config.contracts.stakingContractId);
}

function getTokenContract(): Contract {
  return new Contract(config.contracts.sxlmTokenContractId);
}

function getLendingContract(): Contract {
  return new Contract(config.contracts.lendingContractId);
}

function getNetworkPassphrase(): string {
  return config.stellar.networkPassphrase;
}

async function getSourceAccount(): Promise<{
  keypair: Keypair;
  account: Awaited<ReturnType<rpc.Server["getAccount"]>>;
}> {
  const keypair = loadKeeperKeypair(config.keeper.secretKey, config.admin.publicKey);
  const account = await server.getAccount(keypair.publicKey());
  return { keypair, account };
}

/**
 * Source account for read-only simulations. Simulation needs an existing
 * account but no signature, so the admin address serves without any secret.
 */
async function getReadAccount(): Promise<Awaited<ReturnType<rpc.Server["getAccount"]>>> {
  return server.getAccount(config.admin.publicKey);
}

export interface DepositResult {
  txHash: string;
  sxlmMinted: bigint;
  exchangeRate: number;
}

export interface WithdrawalRequestResult {
  txHash: string;
  withdrawalId: number;
  unlockTime: Date;
  isInstant: boolean;
  xlmAmount: bigint;
}

export interface ClaimResult {
  txHash: string;
  xlmReturned: bigint;
}

/**
 * Read a Soroban return value out of transaction metadata.
 *
 * The metadata union gains a new arm with each protocol version — v3 under
 * protocol 21, v4 from 23 onward — and calling the wrong accessor throws
 * "Bad union switch" rather than returning nothing. Ask the discriminant
 * first and fall back, so a protocol bump degrades to a missing value instead
 * of a crash.
 */
function readReturnValue(meta: unknown): xdr.ScVal | undefined {
  const m = meta as { switch?: () => { value: number }; v3?: () => unknown; v4?: () => unknown };
  if (!m || typeof m.switch !== "function") return undefined;
  try {
    const arm = m.switch().value;
    const soroban =
      arm === 3 && typeof m.v3 === "function"
        ? (m.v3() as { sorobanMeta?: () => { returnValue?: () => xdr.ScVal } | null })
        : arm === 4 && typeof m.v4 === "function"
          ? (m.v4() as { sorobanMeta?: () => { returnValue?: () => xdr.ScVal } | null })
          : undefined;
    return soroban?.sorobanMeta?.()?.returnValue?.();
  } catch {
    return undefined;
  }
}

export async function callDeposit(
  userPublicKey: string,
  xlmAmount: bigint
): Promise<DepositResult> {
  const { keypair, account } = await getSourceAccount();
  const contract = getStakingContract();

  const depositOp = contract.call(
    "deposit",
    new Address(userPublicKey).toScVal(),
    nativeToScVal(xlmAmount, { type: "i128" })
  );

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(depositOp)
    .setTimeout(300)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(keypair);

  const sendResult = await server.sendTransaction(preparedTx);

  if (sendResult.status === "ERROR") {
    throw new Error(`Deposit transaction failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  const txResult = await pollTransaction(sendResult.hash);

  const returnValue = readReturnValue(txResult.resultMetaXdr);

  let sxlmMinted = BigInt(0);
  if (returnValue) {
    sxlmMinted = BigInt(scValToNative(returnValue));
  }

  const exchangeRate = await getExchangeRate();

  return {
    txHash: sendResult.hash,
    sxlmMinted,
    exchangeRate,
  };
}

export async function callRequestWithdrawal(
  userPublicKey: string,
  sxlmAmount: bigint
): Promise<WithdrawalRequestResult> {
  const { keypair, account } = await getSourceAccount();
  const contract = getStakingContract();

  const withdrawOp = contract.call(
    "request_withdrawal",
    new Address(userPublicKey).toScVal(),
    nativeToScVal(sxlmAmount, { type: "i128" })
  );

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(withdrawOp)
    .setTimeout(300)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(keypair);

  const sendResult = await server.sendTransaction(preparedTx);

  if (sendResult.status === "ERROR") {
    throw new Error(
      `Withdrawal request failed: ${JSON.stringify(sendResult.errorResult)}`
    );
  }

  const txResult = await pollTransaction(sendResult.hash);

  const returnValue = readReturnValue(txResult.resultMetaXdr);

  let withdrawalId = 0;
  let isInstant = false;
  let xlmAmount = BigInt(0);

  if (returnValue) {
    const result = scValToNative(returnValue) as {
      withdrawal_id: number;
      is_instant: boolean;
      xlm_amount: bigint;
    };
    withdrawalId = Number(result.withdrawal_id);
    isInstant = result.is_instant;
    xlmAmount = BigInt(result.xlm_amount);
  }

  const unlockTime = isInstant
    ? new Date()
    : new Date(Date.now() + config.protocol.unbondingPeriodMs);

  return {
    txHash: sendResult.hash,
    withdrawalId,
    unlockTime,
    isInstant,
    xlmAmount,
  };
}

export async function callClaimWithdrawal(
  userPublicKey: string,
  withdrawalId: number
): Promise<ClaimResult> {
  const { keypair, account } = await getSourceAccount();
  const contract = getStakingContract();

  const claimOp = contract.call(
    "claim_withdrawal",
    new Address(userPublicKey).toScVal(),
    nativeToScVal(withdrawalId, { type: "u64" })
  );

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(claimOp)
    .setTimeout(300)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(keypair);

  const sendResult = await server.sendTransaction(preparedTx);

  if (sendResult.status === "ERROR") {
    throw new Error(`Claim failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  const txResult = await pollTransaction(sendResult.hash);

  const returnValue = readReturnValue(txResult.resultMetaXdr);

  let xlmReturned = BigInt(0);
  if (returnValue) {
    xlmReturned = BigInt(scValToNative(returnValue));
  }

  return {
    txHash: sendResult.hash,
    xlmReturned,
  };
}

export async function getExchangeRate(): Promise<number> {
  const contract = getStakingContract();
  const account = await getReadAccount();

  const readOp = contract.call("get_exchange_rate");

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(readOp)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`getExchangeRate simulation failed: ${simResult.error}`);
  }

  if (rpc.Api.isSimulationSuccess(simResult) && simResult.result) {
    const raw = scValToNative(simResult.result.retval);
    // Contract returns rate as i128 with 7 decimal precision (stroops)
    return Number(raw) / 1e7;
  }

  throw new Error("getExchangeRate: no result from simulation");
}

export async function getTotalStaked(): Promise<bigint> {
  const contract = getStakingContract();
  const account = await getReadAccount();

  const readOp = contract.call("total_xlm_staked");

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(readOp)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`getTotalStaked simulation failed: ${simResult.error}`);
  }

  if (rpc.Api.isSimulationSuccess(simResult) && simResult.result) {
    return BigInt(scValToNative(simResult.result.retval));
  }

  throw new Error("getTotalStaked: no result from simulation");
}

export async function getTotalSupply(): Promise<bigint> {
  const contract = getTokenContract();
  const account = await getReadAccount();

  const readOp = contract.call("total_supply");

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(readOp)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`getTotalSupply simulation failed: ${simResult.error}`);
  }

  if (rpc.Api.isSimulationSuccess(simResult) && simResult.result) {
    return BigInt(scValToNative(simResult.result.retval));
  }

  throw new Error("getTotalSupply: no result from simulation");
}

export async function getLiquidityBuffer(): Promise<bigint> {
  const contract = getStakingContract();
  const account = await getReadAccount();

  const readOp = contract.call("liquidity_buffer");

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(readOp)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`getLiquidityBuffer simulation failed: ${simResult.error}`);
  }

  if (rpc.Api.isSimulationSuccess(simResult) && simResult.result) {
    return BigInt(scValToNative(simResult.result.retval));
  }

  throw new Error("getLiquidityBuffer: no result from simulation");
}

export async function getPendingWithdrawals(): Promise<bigint> {
  const contract = getStakingContract();
  const account = await getReadAccount();

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(contract.call("pending_withdrawals"))
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`getPendingWithdrawals simulation failed: ${simResult.error}`);
  }
  if (rpc.Api.isSimulationSuccess(simResult) && simResult.result) {
    return BigInt(scValToNative(simResult.result.retval));
  }
  throw new Error("getPendingWithdrawals: no result from simulation");
}

export async function getIdleBalance(): Promise<bigint> {
  const contract = getStakingContract();
  const account = await getReadAccount();

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(contract.call("idle_balance"))
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`getIdleBalance simulation failed: ${simResult.error}`);
  }
  if (rpc.Api.isSimulationSuccess(simResult) && simResult.result) {
    return BigInt(scValToNative(simResult.result.retval));
  }
  throw new Error("getIdleBalance: no result from simulation");
}


export async function getTreasuryBalance(): Promise<bigint> {
  const contract = getStakingContract();
  const account = await getReadAccount();

  const readOp = contract.call("treasury_balance");

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(readOp)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`getTreasuryBalance simulation failed: ${simResult.error}`);
  }

  if (rpc.Api.isSimulationSuccess(simResult) && simResult.result) {
    return BigInt(scValToNative(simResult.result.retval));
  }

  throw new Error("getTreasuryBalance: no result from simulation");
}

export async function getIsPaused(): Promise<boolean> {
  const contract = getStakingContract();
  const account = await getReadAccount();

  const readOp = contract.call("is_paused");

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(readOp)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`getIsPaused simulation failed: ${simResult.error}`);
  }

  if (rpc.Api.isSimulationSuccess(simResult) && simResult.result) {
    return scValToNative(simResult.result.retval) as boolean;
  }

  return false;
}

export async function getProtocolFeeBps(): Promise<number> {
  const contract = getStakingContract();
  const account = await getReadAccount();

  const readOp = contract.call("protocol_fee_bps");

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(readOp)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simResult)) {
    return 1000; // default 10%
  }

  if (rpc.Api.isSimulationSuccess(simResult) && simResult.result) {
    return Number(scValToNative(simResult.result.retval));
  }

  return 1000;
}

// Admin-only vault calls (withdraw_fees, pause, unpause, set_*) are not made
// from this service. The admin is a multisig account; those transactions are
// built and signed offline. See docs/OPERATIONS.md.

/**
 * LP pool reads. Fee collection is permissionless and done by the keeper
 * (keeper/index.ts). Vault and lending parameters are applied by the governance
 * contract during execute_proposal; there is no admin-key path for them here.
 */

function getLpPoolContract(): Contract {
  return new Contract(config.contracts.lpPoolContractId);
}

export async function getLpAccruedProtocolFees(): Promise<bigint> {
  const contract = getLpPoolContract();
  const account = await getReadAccount();

  const readOp = contract.call("accrued_protocol_fees");

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(readOp)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationSuccess(simResult) && simResult.result) {
    return BigInt(scValToNative(simResult.result.retval));
  }

  return BigInt(0);
}

async function pollTransaction(
  hash: string,
  maxAttempts = 30,
  intervalMs = 2000
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const txResponse = await server.getTransaction(hash);

    if (txResponse.status === "SUCCESS") {
      return txResponse as rpc.Api.GetSuccessfulTransactionResponse;
    }

    if (txResponse.status === "FAILED") {
      throw new Error(
        `Transaction ${hash} failed: ${JSON.stringify(txResponse)}`
      );
    }

    // NOT_FOUND means still pending
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Transaction ${hash} not confirmed after ${maxAttempts} attempts`
  );
}

// callUpdateLendingExchangeRate removed: lending reads get_exchange_rate from
// the vault cross-contract, so the rate cannot drift between the two and no
// off-chain service needs write access to a price.

