import { rpc, Contract, Address, nativeToScVal, scValToNative, Keypair, TransactionBuilder, BASE_FEE, } from "@stellar/stellar-sdk";
import { config } from "../config/index.js";
const server = new rpc.Server(config.stellar.rpcUrl);
function getStakingContract() {
    return new Contract(config.contracts.stakingContractId);
}
function getTokenContract() {
    return new Contract(config.contracts.sxlmTokenContractId);
}
function getLendingContract() {
    return new Contract(config.contracts.lendingContractId);
}
function getNetworkPassphrase() {
    return config.stellar.networkPassphrase;
}
async function getSourceAccount() {
    const keypair = Keypair.fromSecret(config.admin.secretKey);
    const account = await server.getAccount(keypair.publicKey());
    return { keypair, account };
}
export async function callDeposit(userPublicKey, xlmAmount) {
    const { keypair, account } = await getSourceAccount();
    const contract = getStakingContract();
    const depositOp = contract.call("deposit", new Address(userPublicKey).toScVal(), nativeToScVal(xlmAmount, { type: "i128" }));
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
export async function callRequestWithdrawal(userPublicKey, sxlmAmount) {
    const { keypair, account } = await getSourceAccount();
    const contract = getStakingContract();
    const withdrawOp = contract.call("request_withdrawal", new Address(userPublicKey).toScVal(), nativeToScVal(sxlmAmount, { type: "i128" }));
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
        throw new Error(`Withdrawal request failed: ${JSON.stringify(sendResult.errorResult)}`);
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
        const result = scValToNative(returnValue);
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
export async function callClaimWithdrawal(userPublicKey, withdrawalId) {
    const { keypair, account } = await getSourceAccount();
    const contract = getStakingContract();
    const claimOp = contract.call("claim_withdrawal", new Address(userPublicKey).toScVal(), nativeToScVal(withdrawalId, { type: "u64" }));
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
export async function getExchangeRate() {
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
export async function getTotalStaked() {
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
export async function getTotalSupply() {
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
export async function getLiquidityBuffer() {
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
export async function getTreasuryBalance() {
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
export async function getIsPaused() {
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
        return scValToNative(simResult.result.retval);
    }
    return false;
}
export async function getProtocolFeeBps() {
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
async function executeAdminContractCall(method, args = []) {
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
export async function callAddRewards(amount) {
    return executeAdminContractCall("add_rewards", [
        nativeToScVal(amount, { type: "i128" }),
    ]);
}
export async function callRecalibrateRate() {
    return executeAdminContractCall("recalibrate_rate");
}
export async function callApplySlashing(slashAmount) {
    return executeAdminContractCall("apply_slashing", [
        nativeToScVal(slashAmount, { type: "i128" }),
    ]);
}
export async function callPause() {
    return executeAdminContractCall("pause");
}
export async function callUnpause() {
    return executeAdminContractCall("unpause");
}
async function pollTransaction(hash, maxAttempts = 30, intervalMs = 2000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const txResponse = await server.getTransaction(hash);
        if (txResponse.status === "SUCCESS") {
            return txResponse;
        }
        if (txResponse.status === "FAILED") {
            throw new Error(`Transaction ${hash} failed: ${JSON.stringify(txResponse)}`);
        }
        // NOT_FOUND means still pending
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Transaction ${hash} not confirmed after ${maxAttempts} attempts`);
}
/**
 * Sync the staking exchange rate to the lending contract.
 * The lending contract stores its own ExchangeRate (sXLM→XLM, scaled by 1e7).
 * Call this after every reward distribution or snapshot to keep health factors current.
 *
 * rate: exchange rate from computeExchangeRate() (e.g. 1.0042)
 * The lending contract expects RATE_PRECISION = 1e7 scaling, so 1.0042 → 10_042_000
 */
export async function callUpdateLendingExchangeRate(rate) {
    // rate is in XLM-per-sXLM float (e.g. 1.0042)
    // Contract expects i128 scaled by RATE_PRECISION = 10_000_000
    const scaledRate = BigInt(Math.round(rate * 10_000_000));
    if (scaledRate <= BigInt(0)) {
        console.warn("[contractClient] callUpdateLendingExchangeRate: rate <= 0, skipping");
        return;
    }
    const { keypair, account } = await getSourceAccount();
    const contract = getLendingContract();
    const op = contract.call("update_exchange_rate", nativeToScVal(scaledRate, { type: "i128" }));
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
        throw new Error(`callUpdateLendingExchangeRate failed: ${JSON.stringify(result.errorResult)}`);
    }
    // update_exchange_rate returns void. server.getTransaction() tries to parse
    // the XDR return value and throws "Bad union switch" on void returns.
    // Use the raw RPC endpoint instead to poll just the status field.
    const rpcUrl = config.stellar.rpcUrl;
    let attempts = 0;
    while (attempts < 30) {
        const resp = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0", id: 1, method: "getTransaction",
                params: { hash: result.hash },
            }),
        });
        const json = (await resp.json());
        const status = json.result?.status;
        if (status === "SUCCESS")
            break;
        if (status === "FAILED")
            throw new Error(`update_exchange_rate tx failed: ${result.hash}`);
        await new Promise((r) => setTimeout(r, 2000));
        attempts++;
    }
    console.log(`[contractClient] Lending exchange rate updated: ${rate.toFixed(7)} (${scaledRate})`);
}
//# sourceMappingURL=contractClient.js.map