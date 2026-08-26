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
  const keypair = Keypair.fromSecret(config.admin.secretKey);
  const account = await server.getAccount(keypair.publicKey());
  return { keypair, account };
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

  const returnValue = txResult.resultMetaXdr
    ?.v3()
    ?.sorobanMeta()
    ?.returnValue();

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

  const returnValue = txResult.resultMetaXdr
    ?.v3()
    ?.sorobanMeta()
    ?.returnValue();

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

  const returnValue = txResult.resultMetaXdr
    ?.v3()
    ?.sorobanMeta()
    ?.returnValue();

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
  const { keypair, account } = await getSourceAccount();

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
  const { keypair, account } = await getSourceAccount();

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
  const { keypair, account } = await getSourceAccount();

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
  const { keypair, account } = await getSourceAccount();

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
  const { account } = await getSourceAccount();

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
  const { account } = await getSourceAccount();

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
  const { keypair, account } = await getSourceAccount();

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
  const { keypair, account } = await getSourceAccount();

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
  const { keypair, account } = await getSourceAccount();

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

/**
 * Helper: execute an admin write call on the staking contract using the SDK.
 * Signs with the admin keypair from config — works on both testnet and mainnet
 * without requiring the Stellar CLI to be installed on the server.
 */
async function executeAdminContractCall(
  method: string,
  args: ReturnType<typeof nativeToScVal>[] = []
): Promise<string> {
  const { keypair, account } = await getSourceAccount();
  const contract = getStakingContract();

  const op = contract.call(method, ...args);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(op)
    .setTimeout(300)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(keypair);

  const result = await server.sendTransaction(preparedTx);
  if (result.status === "ERROR") {
    throw new Error(`${method} failed: ${JSON.stringify(result.errorResult)}`);
  }

  await pollTransaction(result.hash);
  console.log(`[contractClient] ${method} executed: ${result.hash}`);
  return result.hash;
}

export async function callWithdrawFees(amount: bigint): Promise<string> {
  return executeAdminContractCall("withdraw_fees", [
    nativeToScVal(amount, { type: "i128" }),
  ]);
}

/**
 * Contribute realised yield to the vault.
 *
 * `add_rewards` now transfers the XLM in rather than incrementing a counter, so
 * the admin account must actually hold `amount` at call time. A shortfall fails
 * the transaction instead of raising the exchange rate against nothing.
 */
export async function callAddRewards(amount: bigint): Promise<string> {
  return executeAdminContractCall("add_rewards", [
    new Address(config.admin.publicKey).toScVal(),
    nativeToScVal(amount, { type: "i128" }),
  ]);
}

// callRecalibrateRate removed: the exchange rate is derived on read, so there is
// nothing to recalibrate.
//
// callApplySlashing removed: it decremented the stored asset counter, which no
// longer exists. Strategy losses become visible through the strategy balance
// itself once the Phase 2 registry lands, reported via report_strategy_loss.

export async function callPause(): Promise<string> {
  return executeAdminContractCall("pause");
}

export async function callUnpause(): Promise<string> {
  return executeAdminContractCall("unpause");
}

/**
 * Governance parameter helpers — apply on-chain after proposal execution.
 */

export async function callSetCooldownPeriod(period: number): Promise<string> {
  return executeAdminContractCall("set_cooldown_period", [
    nativeToScVal(period, { type: "u64" }),
  ]);
}

function getLpPoolContract(): Contract {
  return new Contract(config.contracts.lpPoolContractId);
}

async function executeLpPoolAdminCall(
  method: string,
  args: ReturnType<typeof nativeToScVal>[] = []
): Promise<string> {
  const { keypair, account } = await getSourceAccount();
  const contract = getLpPoolContract();

  const op = contract.call(method, ...args);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(op)
    .setTimeout(300)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(keypair);

  const result = await server.sendTransaction(preparedTx);
  if (result.status === "ERROR") {
    throw new Error(`lp_pool::${method} failed: ${JSON.stringify(result.errorResult)}`);
  }

  await pollTransaction(result.hash);
  console.log(`[contractClient] lp_pool::${method} executed: ${result.hash}`);
  return result.hash;
}

export async function callCollectProtocolFees(): Promise<string> {
  return executeLpPoolAdminCall("collect_protocol_fees");
}

export async function callSetLpProtocolFeeBps(bps: number): Promise<string> {
  return executeLpPoolAdminCall("set_protocol_fee_bps", [
    nativeToScVal(bps, { type: "u32" }),
  ]);
}

export async function getLpAccruedProtocolFees(): Promise<bigint> {
  const contract = getLpPoolContract();
  const { keypair, account } = await getSourceAccount();

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

async function executeLendingAdminCall(
  method: string,
  args: ReturnType<typeof nativeToScVal>[] = []
): Promise<string> {
  const { keypair, account } = await getSourceAccount();
  const contract = getLendingContract();

  const op = contract.call(method, ...args);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(op)
    .setTimeout(300)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(keypair);

  const result = await server.sendTransaction(preparedTx);
  if (result.status === "ERROR") {
    throw new Error(`lending::${method} failed: ${JSON.stringify(result.errorResult)}`);
  }

  await pollTransaction(result.hash);
  console.log(`[contractClient] lending::${method} executed: ${result.hash}`);
  return result.hash;
}

export async function callUpdateCollateralFactor(bps: number): Promise<string> {
  return executeLendingAdminCall("update_collateral_factor", [
    nativeToScVal(bps, { type: "u64" }),
  ]);
}

export async function callUpdateBorrowRate(bps: number): Promise<string> {
  return executeLendingAdminCall("update_borrow_rate", [
    nativeToScVal(bps, { type: "u64" }),
  ]);
}

export async function callUpdateLiquidationThreshold(bps: number): Promise<string> {
  return executeLendingAdminCall("update_liquidation_threshold", [
    nativeToScVal(bps, { type: "u64" }),
  ]);
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

