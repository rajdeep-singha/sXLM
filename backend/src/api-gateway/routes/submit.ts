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
import { getRpc, latestLedgerSequence, rpcRequest } from "../../stellar/network.js";
import { openWithdrawalsFor, pickWithdrawal } from "../../vault-engine/withdrawalLookup.js";
import { StakingEngine } from "../../vault-engine/index.js";

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
  const server = getRpc();

  /**
   * POST /staking/submit
   * Submit a user-signed transaction XDR to the Stellar network.
   * Sends raw XDR directly to Soroban RPC to avoid SDK parsing issues.
   */
  fastify.post("/staking/submit", async (request, reply) => {
    try {
      const body = submitSchema.parse(request.body);

      // Send the signed XDR as raw JSON-RPC, with provider failover. This
      // avoids TransactionBuilder.fromXDR parsing issues with Soroban
      // envelopes. A resubmission to a second provider is safe: the network
      // applies a transaction hash at most once.
      let sent: { hash: string; status: string; errorResultXdr?: string } | undefined;
      try {
        sent = await rpcRequest<{ hash: string; status: string; errorResultXdr?: string }>(
          "sendTransaction",
          { transaction: body.signedXdr }
        );
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "RPC error",
        });
      }

      if (!sent) {
        return reply.status(400).send({ error: "No result from RPC" });
      }

      const { hash, status } = sent;

      if (status === "ERROR") {
        return reply.status(400).send({
          error: `Transaction rejected: ${sent.errorResultXdr || "unknown error"}`,
        });
      }

      // Poll for confirmation using raw JSON-RPC (avoids SDK XDR parse errors)
      const confirmed = await pollTransaction(hash);

      return {
        txHash: hash,
        status: confirmed.status,
        ledger: confirmed.ledger,
        pending: confirmed.pending ?? false,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? "Submit failed";
      reply.status(400).send({ error: message });
    }
  });

  /**
   * POST /staking/claim
   * Build an unsigned claim withdrawal transaction for user to sign.
   *
   * The contract numbers withdrawals globally from 0 while the frontend DB
   * numbers its own rows from 1, so the request to claim is looked up
   * on-chain for this user rather than taken from the DB id.
   */
  fastify.post("/staking/claim", async (request, reply) => {
    try {
      const body = claimSchema.parse(request.body);

      // The DB id the frontend sends is not the contract's id, so look the
      // user's requests up on-chain. The DB id is honoured only if it happens
      // to name one of the user's own open requests.
      const open = await openWithdrawalsFor(body.userAddress);
      const latestLedger = await latestLedgerSequence();
      const preferred = Number.parseInt(body.withdrawalId, 10);
      const withdrawal = pickWithdrawal(
        open,
        latestLedger,
        Number.isFinite(preferred) ? preferred : undefined
      );
      if (withdrawal === null) {
        return reply.status(400).send({
          error: "No unclaimed withdrawal found for your address. It may already be claimed or the cooldown has not started yet.",
        });
      }

      // Check cooldown BEFORE simulation — Soroban panic messages don't
      // surface as readable text, just "UnreachableCodeReached".
      if (latestLedger < withdrawal.unlockLedger) {
        const remaining = withdrawal.unlockLedger - latestLedger;
        const minsLeft = Math.ceil((remaining * 5) / 60);
        return reply.status(400).send({
          error: `Cooldown not expired yet. Approximately ${minsLeft} minutes remaining (~${remaining} ledgers).`,
        });
      }

      const contract = new Contract(config.contracts.stakingContractId);
      const claimOp = contract.call(
        "claim_withdrawal",
        new Address(body.userAddress).toScVal(),
        nativeToScVal(withdrawal.id, { type: "u64" })
      );

      const account = await server.getAccount(body.userAddress);
      const tx = new TransactionBuilder(account, {
        fee: "2000000", // 0.2 XLM — assembleTransaction adds minResourceFee on top
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
        contractWithdrawalId: withdrawal.id,
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
 *
 * Strategy: poll up to 60s with increasing back-off to survive rate limits.
 * If still unconfirmed, return PENDING (not an error) so the frontend can
 * show the hash and let the user verify manually.
 */
async function pollTransaction(
  hash: string,
): Promise<{ status: string; ledger?: number; pending?: boolean }> {
  // Poll schedule: 6×2s, then 6×4s, then 6×6s ≈ 72s total, 18 requests
  const schedule = [
    ...Array(6).fill(2000),
    ...Array(6).fill(4000),
    ...Array(6).fill(6000),
  ];

  for (const intervalMs of schedule) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    let result: { status: string; ledger?: number; errorResultXdr?: string } | undefined;
    try {
      result = await rpcRequest<{ status: string; ledger?: number; errorResultXdr?: string }>(
        "getTransaction",
        { hash }
      );
    } catch {
      // Every provider failed this round, or rate-limited it — wait and retry.
      continue;
    }

    if (result?.status === "SUCCESS") {
      return { status: "SUCCESS", ledger: result.ledger };
    }

    if (result?.status === "FAILED") {
      throw new Error(`Transaction failed on-chain: ${result.errorResultXdr || "unknown error"}`);
    }

    // NOT_FOUND → still pending, keep waiting
  }

  // Timed out — return PENDING so frontend shows success with hash
  return { status: "PENDING", pending: true };
}
