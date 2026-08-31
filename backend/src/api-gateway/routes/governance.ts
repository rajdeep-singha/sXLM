import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  rpc,
  Contract,
  Address,
  nativeToScVal,
  scValToNative,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { config } from "../../config/index.js";
import { PrismaClient } from "@prisma/client";

/**
 * Parameters governance can change, and where each one lives.
 *
 * A proposal names a target contract and a symbol that contract recognises.
 * Anything outside this table would be approved by voters and then revert at
 * execution, so the set is fixed here rather than accepted as free text.
 */
const GOVERNABLE_PARAMS = {
  fee_bps:   { target: "vault",   symbol: "fee_bps",   label: "Protocol fee (bps)",            max: 10000 },
  cooldown:  { target: "vault",   symbol: "cooldown",  label: "Withdrawal cooldown (ledgers)", max: 2_000_000 },
  coll_fact: { target: "lending", symbol: "coll_fact", label: "Collateral factor (bps)",       max: 10000 },
  liq_thres: { target: "lending", symbol: "liq_thres", label: "Liquidation threshold (bps)",   max: 10000 },
  bor_rate:  { target: "lending", symbol: "bor_rate",  label: "Borrow rate (bps)",             max: 10000 },
  max_util:  { target: "lending", symbol: "max_util",  label: "Reserve utilisation cap (bps)", max: 10000 },
} as const;

type ParamKey = keyof typeof GOVERNABLE_PARAMS;

const createProposalSchema = z.object({
  userAddress: z.string().min(56).max(56),
  paramKey: z.enum(Object.keys(GOVERNABLE_PARAMS) as [ParamKey, ...ParamKey[]]),
  newValue: z.number().int().nonnegative(),
});

const voteSchema = z.object({
  userAddress: z.string().min(56).max(56),
  proposalId: z.number().int().min(0),
  support: z.boolean(),
  // sXLM to escrow for the vote, in whole sXLM. Weight equals the amount
  // locked; it is returned once voting closes.
  amount: z.number().positive(),
});

const executeSchema = z.object({
  userAddress: z.string().min(56).max(56),
  proposalId: z.number().int().min(0),
});

async function buildContractTx(
  server: rpc.Server,
  contractId: string,
  method: string,
  args: any[],
  userAddress: string
) {
  const contract = new Contract(contractId);
  const op = contract.call(method, ...args);

  const account = await server.getAccount(userAddress);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.stellar.networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(300)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simResult)) {
    const errStr = String(simResult.error);
    if (errStr.includes("UnreachableCodeReached")) {
      if (method === "vote") {
        throw new Error("You need sXLM to vote. Stake XLM first to receive sXLM, then vote.");
      }
      if (method === "create_proposal") {
        throw new Error("You need at least 100 sXLM to create a proposal. Stake XLM first.");
      }
      if (method === "execute_proposal") {
        throw new Error("Proposal cannot be executed — voting period may not be over, quorum not met, or it already executed.");
      }
    }
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const preparedTx = rpc.assembleTransaction(tx, simResult).build();
  return {
    xdr: preparedTx.toXDR(),
    networkPassphrase: config.stellar.networkPassphrase,
  };
}

async function queryContractView(
  server: rpc.Server,
  contractId: string,
  method: string,
  args: any[]
) {
  const contract = new Contract(contractId);
  const op = contract.call(method, ...args);

  const account = await server.getAccount(config.admin.publicKey);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.stellar.networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationSuccess(simResult) && simResult.result) {
    return scValToNative(simResult.result.retval);
  }
  return null;
}


export const governanceRoutes: FastifyPluginAsync<{ prisma: PrismaClient }> = async (
  fastify,
  opts
) => {
  const { prisma } = opts;
  const server = new rpc.Server(config.stellar.rpcUrl);
  const govContractId = config.contracts.governanceContractId;

  /**
   * POST /governance/create-proposal
   * Build unsigned tx: create a new governance proposal.
   */
  fastify.post("/governance/create-proposal", async (request, reply) => {
    try {
      const body = createProposalSchema.parse(request.body);
      const param = GOVERNABLE_PARAMS[body.paramKey];

      if (body.newValue > param.max) {
        return reply.status(400).send({
          error: `${param.label} cannot exceed ${param.max}.`,
        });
      }

      const targetId =
        param.target === "vault"
          ? config.contracts.stakingContractId
          : config.contracts.lendingContractId;

      const result = await buildContractTx(
        server,
        govContractId,
        "create_proposal",
        [
          new Address(body.userAddress).toScVal(),
          new Address(targetId).toScVal(),
          nativeToScVal(param.symbol, { type: "symbol" }),
          nativeToScVal(BigInt(body.newValue), { type: "i128" }),
        ],
        body.userAddress
      );

      // Also store in DB for quick querying
      const votingPeriodLedgers = 17280; // ~24h
      await prisma.governanceProposal.create({
        data: {
          proposer: body.userAddress,
          paramKey: body.paramKey,
          newValue: String(body.newValue),
          status: "active",
          expiresAt: new Date(
            Date.now() + votingPeriodLedgers * 5 * 1000 // ~5s per ledger
          ),
        },
      });

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Create proposal failed";
      reply.status(400).send({ error: message });
    }
  });

  /**
   * POST /governance/vote
   * Build unsigned tx: vote on a proposal.
   */
  fastify.post("/governance/vote", async (request, reply) => {
    try {
      const body = voteSchema.parse(request.body);

      // Pre-flight: check user has sXLM to vote with
      const sxlmRaw = await queryContractView(
        server,
        config.contracts.sxlmTokenContractId,
        "balance",
        [new Address(body.userAddress).toScVal()]
      );
      const sxlmBalance = BigInt(sxlmRaw ?? 0);
      const voteStroops = BigInt(Math.floor(body.amount * 1e7));
      if (sxlmBalance < voteStroops) {
        return reply.status(400).send({
          error:
            `Voting escrows sXLM until the vote closes. You hold ${
              Number(sxlmBalance) / 1e7
            } sXLM but tried to vote with ${body.amount}.`,
        });
      }

      const result = await buildContractTx(
        server,
        govContractId,
        "vote",
        [
          new Address(body.userAddress).toScVal(),
          nativeToScVal(BigInt(body.proposalId), { type: "u64" }),
          nativeToScVal(body.support, { type: "bool" }),
          nativeToScVal(voteStroops, { type: "i128" }),
        ],
        body.userAddress
      );

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Vote failed";
      reply.status(400).send({ error: message });
    }
  });

  /**
   * POST /governance/execute
   * Build unsigned tx: execute a passed proposal.
   */
  fastify.post("/governance/execute", async (request, reply) => {
    try {
      const body = executeSchema.parse(request.body);

      const result = await buildContractTx(
        server,
        govContractId,
        "execute_proposal",
        [nativeToScVal(BigInt(body.proposalId), { type: "u64" })],
        body.userAddress
      );

      // Update DB status and apply the parameter change
      const dbProposal = await prisma.governanceProposal.findFirst({
        where: { id: body.proposalId + 1 }, // DB is 1-indexed
      });
      if (dbProposal) {
        await prisma.governanceProposal.update({
          where: { id: dbProposal.id },
          data: { status: "executed" },
        });

        // The contract applies the parameter itself during execute_proposal.
        // Re-applying it here with the admin key would bypass governance.
      }

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Execution failed";
      reply.status(400).send({ error: message });
    }
  });

  /**
   * GET /governance/proposals
   * Fetch proposals from on-chain + DB.
   */
  fastify.get("/governance/proposals", async () => {
    try {
      const proposalCount = await queryContractView(
        server,
        govContractId,
        "proposal_count",
        []
      );

      const count = Number(proposalCount ?? 0);
      const proposals = [];

      // Fetch each proposal from contract
      for (let i = 0; i < Math.min(count, 50); i++) {
        try {
          const proposal = await queryContractView(
            server,
            govContractId,
            "get_proposal",
            [nativeToScVal(BigInt(i), { type: "u64" })]
          );

          if (proposal) {
            const voteCount = await queryContractView(
              server,
              govContractId,
              "get_vote_count",
              [nativeToScVal(BigInt(i), { type: "u64" })]
            );

            // Determine proposal status
            const endLedger = proposal.end_ledger ?? 0;
            const votesForBig = BigInt(voteCount?.[0] ?? 0);
            const votesAgainstBig = BigInt(voteCount?.[1] ?? 0);
            let status = "active";
            if (proposal.executed) {
              status = "executed";
            } else if (endLedger > 0) {
              // Check if voting period ended by comparing with latest ledger
              // We can't easily get current ledger here, so use a time estimate:
              // If proposal has end_ledger and start_ledger, check time elapsed
              const startLedger = proposal.start_ledger ?? 0;
              const votingPeriod = endLedger - startLedger;
              const elapsedMs = Date.now() - (proposal.created_at ? new Date(proposal.created_at).getTime() : Date.now());
              const expectedDurationMs = votingPeriod * 5 * 1000; // ~5s per ledger
              if (elapsedMs > expectedDurationMs) {
                status = votesForBig > votesAgainstBig ? "passed" : "rejected";
              }
            }

            proposals.push({
              id: i,
              proposer: proposal.proposer?.toString() ?? "",
              paramKey: proposal.param_key ?? "",
              newValue: proposal.new_value ?? "",
              votesFor: (voteCount?.[0] ?? 0).toString(),
              votesAgainst: (voteCount?.[1] ?? 0).toString(),
              startLedger: proposal.start_ledger ?? 0,
              endLedger: endLedger,
              executed: proposal.executed ?? false,
              status,
            });

            // Sync to DB
            const existing = await prisma.governanceProposal.findFirst({
              where: {
                proposer: proposal.proposer?.toString() ?? "",
                paramKey: proposal.param_key ?? "",
              },
            });
            if (existing) {
              await prisma.governanceProposal.update({
                where: { id: existing.id },
                data: {
                  votesFor: BigInt(voteCount?.[0] ?? 0),
                  votesAgainst: BigInt(voteCount?.[1] ?? 0),
                  status: proposal.executed ? "executed" : "active",
                },
              });
            }
          }
        } catch {
          // Skip proposal if query fails
        }
      }

      // If no on-chain proposals, return from DB
      if (proposals.length === 0) {
        const dbProposals = await prisma.governanceProposal.findMany({
          orderBy: { createdAt: "desc" },
        });
        return {
          proposals: dbProposals.map((p) => ({
            id: p.id - 1,
            proposer: p.proposer,
            paramKey: p.paramKey,
            newValue: p.newValue,
            votesFor: p.votesFor.toString(),
            votesAgainst: p.votesAgainst.toString(),
            status: p.status,
            expiresAt: p.expiresAt.toISOString(),
          })),
          total: dbProposals.length,
        };
      }

      return { proposals, total: proposals.length };
    } catch {
      // Fallback to DB
      const dbProposals = await prisma.governanceProposal.findMany({
        orderBy: { createdAt: "desc" },
      });
      return {
        proposals: dbProposals.map((p) => ({
          id: p.id - 1,
          proposer: p.proposer,
          paramKey: p.paramKey,
          newValue: p.newValue,
          votesFor: p.votesFor.toString(),
          votesAgainst: p.votesAgainst.toString(),
          status: p.status,
          expiresAt: p.expiresAt.toISOString(),
        })),
        total: dbProposals.length,
      };
    }
  });

  /**
   * GET /governance/proposals/:id
   */
  fastify.get("/governance/proposals/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const proposalId = parseInt(id, 10);

    try {
      const proposal = await queryContractView(
        server,
        govContractId,
        "get_proposal",
        [nativeToScVal(proposalId, { type: "u64" })]
      );

      if (!proposal) {
        return reply.status(404).send({ error: "Proposal not found" });
      }

      const voteCount = await queryContractView(
        server,
        govContractId,
        "get_vote_count",
        [nativeToScVal(proposalId, { type: "u64" })]
      );

      return {
        id: proposalId,
        proposer: proposal.proposer?.toString() ?? "",
        paramKey: proposal.param_key ?? "",
        newValue: proposal.new_value ?? "",
        votesFor: (voteCount?.[0] ?? 0).toString(),
        votesAgainst: (voteCount?.[1] ?? 0).toString(),
        startLedger: proposal.start_ledger ?? 0,
        endLedger: proposal.end_ledger ?? 0,
        executed: proposal.executed ?? false,
        status: proposal.executed ? "executed" : "active",
      };
    } catch {
      // Fallback to DB
      const dbProposal = await prisma.governanceProposal.findFirst({
        where: { id: proposalId + 1 },
      });
      if (!dbProposal) {
        return reply.status(404).send({ error: "Proposal not found" });
      }
      return {
        id: proposalId,
        proposer: dbProposal.proposer,
        paramKey: dbProposal.paramKey,
        newValue: dbProposal.newValue,
        votesFor: dbProposal.votesFor.toString(),
        votesAgainst: dbProposal.votesAgainst.toString(),
        status: dbProposal.status,
        expiresAt: dbProposal.expiresAt.toISOString(),
      };
    }
  });

  /**
   * GET /governance/params
   *
   * Live values read from the contract that owns each parameter, not from
   * governance's record of the last approved value — the contract is what
   * actually applies.
   */
  fastify.get("/governance/params", async () => {
    const vaultId = config.contracts.stakingContractId;
    const lendingId = config.contracts.lendingContractId;

    const sources: Array<{
      key: keyof typeof GOVERNABLE_PARAMS;
      contract: string;
      method: string;
    }> = [
      { key: "fee_bps",   contract: vaultId,   method: "protocol_fee_bps" },
      { key: "cooldown",  contract: vaultId,   method: "get_cooldown_period" },
      { key: "coll_fact", contract: lendingId, method: "get_collateral_factor" },
      { key: "liq_thres", contract: lendingId, method: "get_liquidation_threshold" },
      { key: "bor_rate",  contract: lendingId, method: "get_borrow_rate" },
      { key: "max_util",  contract: lendingId, method: "get_max_utilization" },
    ];

    const params = await Promise.all(
      sources.map(async ({ key, contract, method }) => {
        const meta = GOVERNABLE_PARAMS[key];
        try {
          const value = await queryContractView(server, contract, method, []);
          return {
            key,
            description: meta.label,
            currentValue: value === null ? null : String(value),
          };
        } catch {
          // Null rather than a plausible-looking default: an unreachable
          // contract should read as unknown, not as a number someone might act on.
          return { key, description: meta.label, currentValue: null };
        }
      })
    );

    return { params };
  });
};
