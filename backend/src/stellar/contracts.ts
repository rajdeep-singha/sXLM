import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  scValToNative,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { config } from "../config/index.js";
import { getRpc } from "./network.js";

/**
 * Thrown when a simulation reaches the network and the contract rejects the
 * call: a missing function, a panic, a failed check. Distinct from transport
 * failures, which the failover layer handles.
 */
export class ContractCallError extends Error {}

/** Simulate a read-only contract call and return its native value. */
export async function view(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = []
): Promise<unknown> {
  const server = getRpc();
  const account = await server.getAccount(config.admin.publicKey);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.stellar.networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new ContractCallError(`${method} on ${contractId.slice(0, 6)}… failed: ${sim.error}`);
  }
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new ContractCallError(`${method} on ${contractId.slice(0, 6)}… returned nothing`);
  }
  return scValToNative(sim.result.retval);
}

