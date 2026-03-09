import { rpc, TransactionBuilder, BASE_FEE, } from "@stellar/stellar-sdk";
import { config } from "../config/index.js";
const server = new rpc.Server(config.stellar.rpcUrl);
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE_MS = 1000;
export async function buildTransaction(opts) {
    const account = await server.getAccount(opts.sourceKeypair.publicKey());
    const builder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: config.stellar.networkPassphrase,
    });
    for (const op of opts.operations) {
        builder.addOperation(op);
    }
    builder.setTimeout(opts.timeoutSeconds ?? 300);
    const tx = builder.build();
    return tx;
}
export async function signTransaction(tx, keypair) {
    tx.sign(keypair);
    return tx;
}
export async function submitTransaction(tx, retries = MAX_RETRIES) {
    let lastError = null;
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const preparedTx = await server.prepareTransaction(tx);
            const sendResponse = await server.sendTransaction(preparedTx);
            if (sendResponse.status === "ERROR") {
                throw new Error(`Submit error: ${JSON.stringify(sendResponse.errorResult)}`);
            }
            if (sendResponse.status === "PENDING") {
                const confirmed = await waitForConfirmation(sendResponse.hash);
                return confirmed;
            }
            // Duplicate or other status
            return {
                hash: sendResponse.hash,
                status: sendResponse.status,
            };
        }
        catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            const isRetryable = lastError.message.includes("timeout") ||
                lastError.message.includes("503") ||
                lastError.message.includes("429") ||
                lastError.message.includes("RESOURCE_LIMIT") ||
                lastError.message.includes("try again");
            if (!isRetryable || attempt === retries - 1) {
                break;
            }
            const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt);
            console.warn(`[TxExecutor] Attempt ${attempt + 1}/${retries} failed, retrying in ${delay}ms:`, lastError.message);
            await sleep(delay);
            // Rebuild transaction with fresh sequence number for retry
            const account = await server.getAccount(tx.source);
            const builder = new TransactionBuilder(account, {
                fee: BASE_FEE,
                networkPassphrase: config.stellar.networkPassphrase,
            });
            const rawOps = (tx.toEnvelope().v1().tx().operations());
            for (const op of rawOps) {
                builder.addOperation(op);
            }
            builder.setTimeout(300);
            tx = builder.build();
        }
    }
    throw lastError ?? new Error("Transaction submission failed after retries");
}
async function waitForConfirmation(hash, maxAttempts = 30, intervalMs = 2000) {
    for (let i = 0; i < maxAttempts; i++) {
        const response = await server.getTransaction(hash);
        if (response.status === "SUCCESS") {
            const successResp = response;
            return {
                hash,
                status: "SUCCESS",
                resultXdr: successResp.resultXdr?.toXDR("base64"),
                ledger: successResp.ledger,
            };
        }
        if (response.status === "FAILED") {
            const failedResp = response;
            throw new Error(`Transaction ${hash} failed: ${failedResp.resultXdr?.toXDR("base64") ?? "unknown error"}`);
        }
        await sleep(intervalMs);
    }
    throw new Error(`Transaction ${hash} not confirmed within ${maxAttempts * 2}s`);
}
export async function executeContractCall(keypair, contractOp, timeoutSeconds = 300) {
    const account = await server.getAccount(keypair.publicKey());
    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: config.stellar.networkPassphrase,
    })
        .addOperation(contractOp)
        .setTimeout(timeoutSeconds)
        .build();
    const preparedTx = await server.prepareTransaction(tx);
    preparedTx.sign(keypair);
    return submitTransaction(preparedTx);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=txExecutor.js.map