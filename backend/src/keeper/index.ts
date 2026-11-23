/**
 * Keeper Bot
 *
 * Keeps the protocol running. Every call it makes is permissionless, so it
 * signs with its own key and never holds admin power.
 *
 * Every 6 hours:
 *   1. collect_protocol_fees on the LP pool — the vault's share is sent to the
 *      vault directly, raising the sXLM rate; the rest goes to the admin.
 *   2. settle_interest on the lending contract — the holders' share of repaid
 *      interest is sent to the vault directly.
 *
 * Every 24 hours:
 *   3. bump_instance on all five contracts so they never archive.
 *
 * Neither step 1 nor step 2 routes money through the keeper or the admin, so
 * there is nothing to forward with add_rewards afterwards.
 */

import {
  rpc,
  Contract,
  nativeToScVal,
  scValToNative,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { config } from "../config/index.js";
import { getRpc } from "../stellar/network.js";
import { getLpAccruedProtocolFees } from "../vault-engine/contractClient.js";
import { loadKeeperKeypair } from "./keys.js";

const KEEPER_INTERVAL_MS = 6 * 60 * 60 * 1000;      // 6 hours
const TTL_BUMP_INTERVAL_MS = 24 * 60 * 60 * 1000;    // 24 hours

/**
 * Every contract method the keeper is allowed to call. Each must be
 * permissionless on-chain; tests/keeper.test.ts checks that against the
 * contract source.
 */
export const KEEPER_METHODS = [
  "bump_instance",
  "settle_interest",
  "collect_protocol_fees",
] as const;

export type KeeperMethod = (typeof KEEPER_METHODS)[number];

let keeperInterval: ReturnType<typeof setInterval> | null = null;
let ttlInterval: ReturnType<typeof setInterval> | null = null;

export interface KeeperStatus {
  running: boolean;
  account: string | null;
  lastUpkeepAt: string | null;
  lastTtlBumpAt: string | null;
  /** Calls that failed in the most recent cycles, by method and contract. */
  lastErrors: string[];
}

export class KeeperBot {
  private server: rpc.Server;
  private readonly state: KeeperStatus = {
    running: false,
    account: null,
    lastUpkeepAt: null,
    lastTtlBumpAt: null,
    lastErrors: [],
  };

  constructor() {
    this.server = getRpc();
  }

  async initialize(): Promise<void> {
    console.log("[KeeperBot] Initializing...");

    // Fail fast on a missing key, or on the admin key, before scheduling anything.
    const keypair = loadKeeperKeypair(config.keeper.secretKey, config.admin.publicKey);
    console.log(`[KeeperBot] Signing as ${keypair.publicKey()}`);
    this.state.account = keypair.publicKey();
    this.state.running = true;

    await this.runUpkeepCycle().catch((err) =>
      console.error("[KeeperBot] Initial upkeep cycle failed:", err)
    );
    await this.bumpAllContractTTLs().catch((err) =>
      console.error("[KeeperBot] Initial TTL bump failed:", err)
    );

    keeperInterval = setInterval(async () => {
      try {
        await this.runUpkeepCycle();
      } catch (err) {
        console.error("[KeeperBot] Upkeep cycle error:", err);
      }
    }, KEEPER_INTERVAL_MS);

    ttlInterval = setInterval(async () => {
      try {
        await this.bumpAllContractTTLs();
      } catch (err) {
        console.error("[KeeperBot] TTL bump error:", err);
      }
    }, TTL_BUMP_INTERVAL_MS);

    console.log(
      `[KeeperBot] Running — upkeep every ${KEEPER_INTERVAL_MS / 3_600_000}h, TTL bump every ${TTL_BUMP_INTERVAL_MS / 3_600_000}h`
    );
  }

  async shutdown(): Promise<void> {
    if (keeperInterval) { clearInterval(keeperInterval); keeperInterval = null; }
    if (ttlInterval) { clearInterval(ttlInterval); ttlInterval = null; }
    this.state.running = false;
    console.log("[KeeperBot] Shut down");
  }

  status(): KeeperStatus {
    return { ...this.state, lastErrors: [...this.state.lastErrors] };
  }

  private recordError(what: string, err: unknown): void {
    const msg = `${new Date().toISOString()} ${what}: ${err instanceof Error ? err.message : String(err)}`;
    this.state.lastErrors = [msg, ...this.state.lastErrors].slice(0, 10);
  }

  // ============================================================
  // Upkeep: move accrued fees and interest to the vault
  // ============================================================

  async runUpkeepCycle(): Promise<void> {
    console.log("[KeeperBot] Starting upkeep cycle...");

    await this.logLpPoolStats();

    try {
      const accrued = await getLpAccruedProtocolFees();
      if (accrued > BigInt(0)) {
        const hash = await this.executeKeeperCall(
          config.contracts.lpPoolContractId,
          "collect_protocol_fees"
        );
        console.log(
          `[KeeperBot] Collected ${Number(accrued) / 1e7} XLM of LP protocol fees: ${hash}`
        );
      }
    } catch (err) {
      console.warn("[KeeperBot] LP protocol fee collection failed:", err);
      this.recordError("collect_protocol_fees", err);
    }

    const pendingInterest = await this.queryLendingAccruedInterest();
    this.state.lastUpkeepAt = new Date().toISOString();
    if (pendingInterest <= BigInt(0)) {
      console.log("[KeeperBot] No lending interest to settle");
      return;
    }

    try {
      const hash = await this.executeKeeperCall(
        config.contracts.lendingContractId,
        "settle_interest"
      );
      const remaining = await this.queryLendingAccruedInterest();
      const settled = pendingInterest > remaining ? pendingInterest - remaining : BigInt(0);
      console.log(
        `[KeeperBot] Settled ${Number(settled) / 1e7} XLM of lending interest ` +
          `(${Number(remaining) / 1e7} XLM still owed by borrowers): ${hash}`
      );
    } catch (err) {
      console.error("[KeeperBot] settle_interest failed:", err);
      this.recordError("settle_interest", err);
    }
  }

  private async queryLendingAccruedInterest(): Promise<bigint> {
    try {
      const result = await this.simulateView(
        config.contracts.lendingContractId,
        "total_accrued_interest",
        []
      );
      return result != null ? BigInt(result as string | number | bigint) : BigInt(0);
    } catch (err) {
      console.warn("[KeeperBot] Could not query accrued interest:", err);
      return BigInt(0);
    }
  }

  // ============================================================
  // Bump TTL on all 5 contracts
  // ============================================================

  async bumpAllContractTTLs(): Promise<void> {
    const contracts = [
      { name: "sXLM Token",  id: config.contracts.sxlmTokenContractId },
      { name: "Staking",     id: config.contracts.stakingContractId },
      { name: "Lending",     id: config.contracts.lendingContractId },
      { name: "LP Pool",     id: config.contracts.lpPoolContractId },
      { name: "Governance",  id: config.contracts.governanceContractId },
    ];

    let bumped = 0;
    for (const c of contracts) {
      try {
        await this.executeKeeperCall(c.id, "bump_instance");
        console.log(`[KeeperBot] TTL bumped: ${c.name}`);
        bumped += 1;
      } catch (err) {
        console.error(`[KeeperBot] TTL bump failed for ${c.name}:`, err);
        this.recordError(`bump_instance ${c.name}`, err);
        // Non-fatal: log and continue
      }
    }
    if (bumped === contracts.length) {
      this.state.lastTtlBumpAt = new Date().toISOString();
    }
  }

  // ============================================================
  // LP Pool stats logging (fees go to LPs via constant product k growth)
  // ============================================================

  private async logLpPoolStats(): Promise<void> {
    try {
      const reserves = await this.simulateView(
        config.contracts.lpPoolContractId,
        "get_reserves",
        []
      );

      const arr = reserves as [string | number | bigint, string | number | bigint] | null;
      const xlm = Number(arr?.[0] ?? 0) / 1e7;
      const sxlm = Number(arr?.[1] ?? 0) / 1e7;
      const k = xlm * sxlm;

      const accruedFees = await getLpAccruedProtocolFees().catch(() => BigInt(0));

      console.log(
        `[KeeperBot] LP Pool: reserve_xlm=${xlm.toFixed(2)}, reserve_sxlm=${sxlm.toFixed(2)}, k=${k.toFixed(2)}, accrued_protocol_fees=${Number(accruedFees) / 1e7} XLM`
      );
    } catch (err) {
      console.warn("[KeeperBot] Could not query LP pool stats:", err);
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  /** Read-only simulation. Needs an existing source account, not a signature. */
  private async simulateView(
    contractId: string,
    method: string,
    args: ReturnType<typeof nativeToScVal>[]
  ): Promise<unknown> {
    const contract = new Contract(contractId);
    const op = contract.call(method, ...args);

    const account = await this.server.getAccount(config.admin.publicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.stellar.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const simResult = await this.server.simulateTransaction(tx);

    if (rpc.Api.isSimulationSuccess(simResult) && simResult.result) {
      return scValToNative(simResult.result.retval);
    }
    return null;
  }

  private async executeKeeperCall(contractId: string, method: KeeperMethod): Promise<string> {
    const keypair = loadKeeperKeypair(config.keeper.secretKey, config.admin.publicKey);
    const account = await this.server.getAccount(keypair.publicKey());

    const contract = new Contract(contractId);
    const op = contract.call(method);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.stellar.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(300)
      .build();

    const preparedTx = await this.server.prepareTransaction(tx);
    preparedTx.sign(keypair);

    const result = await this.server.sendTransaction(preparedTx);
    if (result.status === "ERROR") {
      throw new Error(`${contractId}::${method} failed: ${JSON.stringify(result.errorResult)}`);
    }

    await this.pollTransaction(result.hash);
    return result.hash;
  }

  private async pollTransaction(
    hash: string,
    maxAttempts = 30,
    intervalMs = 2000
  ): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const txResponse = await this.server.getTransaction(hash);

      if (txResponse.status === "SUCCESS") {
        return;
      }

      if (txResponse.status === "FAILED") {
        throw new Error(`Transaction ${hash} failed`);
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Transaction ${hash} not confirmed after ${maxAttempts} attempts`);
  }
}
