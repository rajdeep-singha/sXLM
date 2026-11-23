import {
  rpc,
  Contract,
  scValToNative,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { config } from "../config/index.js";
import { getRpc } from "../stellar/network.js";

const server = getRpc();

function getStakingContract(): Contract {
  return new Contract(config.contracts.stakingContractId);
}

function getTokenContract(): Contract {
  return new Contract(config.contracts.sxlmTokenContractId);
}

function getNetworkPassphrase(): string {
  return config.stellar.networkPassphrase;
}

/**
 * Source account for read-only simulations. Simulation needs an existing
 * account but no signature, so the admin address serves without any secret.
 */
async function getReadAccount(): Promise<Awaited<ReturnType<rpc.Server["getAccount"]>>> {
  return server.getAccount(config.admin.publicKey);
}

// Deposits, withdrawal requests and claims are signed by the user in their
// wallet (see api-gateway/routes/stake.ts, unstake.ts, submit.ts). The backend
// builds unsigned transactions for them; it never acts for a user.

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


// callUpdateLendingExchangeRate removed: lending reads get_exchange_rate from
// the vault cross-contract, so the rate cannot drift between the two and no
// off-chain service needs write access to a price.

