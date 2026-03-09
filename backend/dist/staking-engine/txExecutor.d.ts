import { Transaction, Keypair, xdr } from "@stellar/stellar-sdk";
export interface TransactionOptions {
    sourceKeypair: Keypair;
    operations: xdr.Operation[];
    timeoutSeconds?: number;
    memo?: string;
}
export interface TransactionResult {
    hash: string;
    status: string;
    resultXdr?: string;
    ledger?: number;
}
export declare function buildTransaction(opts: TransactionOptions): Promise<Transaction>;
export declare function signTransaction(tx: Transaction, keypair: Keypair): Promise<Transaction>;
export declare function submitTransaction(tx: Transaction, retries?: number): Promise<TransactionResult>;
export declare function executeContractCall(keypair: Keypair, contractOp: xdr.Operation, timeoutSeconds?: number): Promise<TransactionResult>;
//# sourceMappingURL=txExecutor.d.ts.map