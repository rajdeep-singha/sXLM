import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  rpc,
  TransactionBuilder,
  Contract,
  Address,
  nativeToScVal,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { config } from "../../config/index.js";
import { StakingEngine } from "../../staking-engine/index.js";

const submitSchema = z.object({
  signedXdr: z.string().min(1),
});

const claimSchema = z.object({
  userAddress: z.string().min(56).max(56),
  withdrawalId: z.string(),
});

export const submitRoutes: FastifyPluginAsync<{ stakingEngine: StakingEngine }> = async (
  fastify,
  opts
) => {
  const server = new rpc.Server(config.stellar.rpcUrl);

  /**
   * POST /staking/submit
   * Submit a user-signed transaction XDR to the Stellar network.
   * Sends raw XDR directly to Soroban RPC to avoid SDK parsing issues.
   */
  fastify.post("/staking/submit", async (request, reply) => {
    try {
      const body = submitSchema.parse(request.body);

      // Send the signed XDR directly to Soroban RPC via JSON-RPC
      // This avoids TransactionBuilder.fromXDR parsing issues with Soroban envelopes
      const rpcResponse = await fetch(config.stellar.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sendTransaction",
          params: { transaction: body.signedXdr },
        }),
      });

      const rpcResult = await rpcResponse.json() as {
        result?: { hash: string; status: string; errorResultXdr?: string };
        error?: { message: string };
      };

      if (rpcResult.error) {
        return reply.status(400).send({
          error: `RPC error: ${rpcResult.error.message}`,
        });
      }

      if (!rpcResult.result) {
        return reply.status(400).send({ error: "No result from RPC" });
      }

      const { hash, status } = rpcResult.result;

      if (status === "ERROR") {
        return reply.status(400).send({
          error: `Transaction rejected: ${rpcResult.result.errorResultXdr || "unknown error"}`,
        });
      }

      // Poll for confirmation using raw JSON-RPC (avoids SDK XDR parse errors)
      const confirmed = await pollTransaction(config.stellar.rpcUrl, hash);

      return {
        txHash: hash,
        status: confirmed.status,
        ledger: confirmed.ledger,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? "Submit failed";
      reply.status(400).send({ error: message });
    }
  });

  /**
   * POST /staking/claim
   * Build an unsigned claim withdrawal transaction for user to sign.
   */
  fastify.post("/staking/claim", async (request, reply) => {
    try {
      const body = claimSchema.parse(request.body);

      const contract = new Contract(config.contracts.stakingContractId);
      const claimOp = contract.call(
        "claim_withdrawal",
        new Address(body.userAddress).toScVal(),
        nativeToScVal(Number(body.withdrawalId), { type: "u64" })
      );

      const account = await server.getAccount(body.userAddress);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: config.stellar.networkPassphrase,
      })
        .addOperation(claimOp)
        .setTimeout(300)
        .build();

      const simResult = await server.simulateTransaction(tx);

      if (rpc.Api.isSimulationError(simResult)) {
        return reply.status(400).send({
          error: `Simulation failed: ${simResult.error}`,
        });
      }

      const preparedTx = rpc.assembleTransaction(tx, simResult).build();

      return {
        xdr: preparedTx.toXDR(),
        networkPassphrase: config.stellar.networkPassphrase,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? "Claim failed";
      reply.status(400).send({ error: message });
    }
  });
};

/**
 * Poll for transaction confirmation using raw JSON-RPC to avoid SDK XDR
 * parse errors ("Bad union switch") that occur with newer protocol versions.
 */
async function pollTransaction(
  rpcUrl: string,
  hash: string,
  maxAttempts = 20,
  intervalMs = 2000
): Promise<{ status: string; ledger?: number }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rpcResponse = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: { hash },
      }),
    });

    const rpcResult = await rpcResponse.json() as {
      result?: { status: string; ledger?: number; errorResultXdr?: string };
      error?: { message: string };
    };

    const result = rpcResult.result;

    if (result?.status === "SUCCESS") {
      return { status: "SUCCESS", ledger: result.ledger };
    }

    if (result?.status === "FAILED") {
      throw new Error(`Transaction ${hash} failed on-chain`);
    }

    // NOT_FOUND means still pending — keep polling
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  // Exhausted attempts — assume tx landed (it was accepted by the network)
  return { status: "SUBMITTED" };
}
