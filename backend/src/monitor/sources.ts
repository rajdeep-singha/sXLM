/**
 * Readings for the alert rules, taken from the chain and Horizon.
 *
 * Everything here is read-only: contract views are simulated with the admin
 * address as source (no signature needed), ledger TTLs come from
 * getLedgerEntries, and account activity from Horizon.
 */

import { nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { config } from "../config/index.js";
import { getRpc, horizonGet, latestLedgerSequence } from "../stellar/network.js";
import { ContractCallError, view } from "../stellar/contracts.js";
import type { AdminOperation, TtlReading, WithdrawalReading } from "./checks.js";

const big = (v: unknown): bigint => BigInt(v as string | number | bigint);

export const CONTRACTS = (): { label: string; id: string }[] => [
  { label: "vault", id: config.contracts.stakingContractId },
  { label: "sXLM token", id: config.contracts.sxlmTokenContractId },
  { label: "lending", id: config.contracts.lendingContractId },
  { label: "LP pool", id: config.contracts.lpPoolContractId },
  { label: "governance", id: config.contracts.governanceContractId },
];

export async function readVault(): Promise<{
  idle: bigint;
  pending: bigint;
  treasury: bigint;
  assets: bigint;
  rate: bigint;
}> {
  const id = config.contracts.stakingContractId;
  const [idle, pending, treasury, assets, rate] = await Promise.all([
    view(id, "idle_balance"),
    view(id, "pending_withdrawals"),
    view(id, "treasury_balance"),
    view(id, "total_assets"),
    view(id, "get_exchange_rate"),
  ]);
  return {
    idle: big(idle),
    pending: big(pending),
    treasury: big(treasury),
    assets: big(assets),
    rate: big(rate),
  };
}

export async function readLatestLedger(): Promise<number> {
  return latestLedgerSequence();
}

/** The WASM hash a contract instance entry points at, if it runs WASM. */
export function wasmHashOf(entry: xdr.LedgerEntryData): xdr.Hash | null {
  if (entry.type !== "contractData") return null;
  const val = entry.contractData.val;
  if (val.type !== "scvContractInstance") return null;
  const executable = val.instance.executable;
  if (executable.type !== "contractExecutableWasm") return null;
  return executable.wasmHash;
}

/** TTL of each contract's instance entry and of the WASM code it runs. */
export async function readTtls(): Promise<TtlReading[]> {
  const server = getRpc();
  const out: TtlReading[] = [];
  for (const c of CONTRACTS()) {
    const instance = await server.getContractData(
      c.id,
      xdr.ScVal.scvLedgerKeyContractInstance(),
      rpc.Durability.Persistent
    );
    out.push({ label: `${c.label} instance`, liveUntilLedger: instance.liveUntilLedgerSeq ?? 0 });

    const hash = wasmHashOf(instance.val);
    if (hash) {
      const code = await server.getLedgerEntries(
        xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash }))
      );
      const entry = code.entries[0];
      out.push({ label: `${c.label} code`, liveUntilLedger: entry?.liveUntilLedgerSeq ?? 0 });
    }
  }
  return out;
}

interface HorizonPage<T> {
  _embedded: { records: T[] };
}

interface HorizonTx {
  source_account: string;
  created_at: string;
}

interface HorizonAccount {
  balances: { asset_type: string; balance: string }[];
}

/** Last transaction the keeper itself submitted, and its XLM balance. */
export async function readKeeper(keeper: string): Promise<{
  lastTxAt: Date | null;
  balanceStroops: bigint | null;
}> {
  let account: HorizonAccount;
  try {
    account = await horizonGet<HorizonAccount>(`/accounts/${keeper}`);
  } catch (err) {
    if (err instanceof Error && /Horizon 404/.test(err.message)) {
      return { lastTxAt: null, balanceStroops: null };
    }
    throw err;
  }
  const native = account.balances.find((b) => b.asset_type === "native");
  const balanceStroops = native ? BigInt(Math.round(Number(native.balance) * 1e7)) : BigInt(0);

  const page = await horizonGet<HorizonPage<HorizonTx>>(
    `/accounts/${keeper}/transactions?order=desc&limit=50`
  );
  // Incoming payments also appear here; only transactions the keeper sent count.
  const own = page._embedded.records.find((t) => t.source_account === keeper);
  return { lastTxAt: own ? new Date(own.created_at) : null, balanceStroops };
}

interface HorizonOperation {
  id: string;
  paging_token: string;
  source_account: string;
  type: string;
  created_at: string;
  transaction_hash: string;
}

/**
 * Operations signed by the admin account since `cursor`. Without a cursor it
 * returns no operations and the newest paging token, so history is not
 * reported as new activity on first start.
 */
export async function readAdminOperations(
  admin: string,
  cursor: string | null
): Promise<{ ops: AdminOperation[]; cursor: string | null }> {
  if (cursor === null) {
    const latest = await horizonGet<HorizonPage<HorizonOperation>>(
      `/accounts/${admin}/operations?order=desc&limit=1`
    );
    return { ops: [], cursor: latest._embedded.records[0]?.paging_token ?? "0" };
  }
  const page = await horizonGet<HorizonPage<HorizonOperation>>(
    `/accounts/${admin}/operations?order=asc&limit=200&cursor=${cursor}`
  );
  const records = page._embedded.records;
  // Payments sent to the admin also list it as a participant; only operations
  // the admin authorised are activity.
  const ops = records
    .filter((o) => o.source_account === admin)
    .map((o) => ({ id: o.id, createdAt: o.created_at, type: o.type, txHash: o.transaction_hash }));
  return { ops, cursor: records.at(-1)?.paging_token ?? cursor };
}

export async function readLending(): Promise<{ totalBorrowed: bigint; poolBalance: bigint }> {
  const id = config.contracts.lendingContractId;
  const [totalBorrowed, poolBalance] = await Promise.all([
    view(id, "total_borrowed"),
    view(id, "get_pool_balance"),
  ]);
  return { totalBorrowed: big(totalBorrowed), poolBalance: big(poolBalance) };
}

interface RawWithdrawal {
  id: number | bigint;
  user: string;
  xlm_amount: number | bigint | string;
  unlock_ledger: number;
  claimed: boolean;
}

function toReading(r: RawWithdrawal): WithdrawalReading {
  return {
    id: Number(r.id),
    user: r.user,
    xlmAmount: big(r.xlm_amount),
    unlockLedger: Number(r.unlock_ledger),
    claimed: r.claimed,
  };
}

/**
 * Every withdrawal request the vault still holds.
 *
 * Version 3 reports how many ids exist and deletes claimed ones, so each id
 * is looked up and misses are skipped. Earlier versions have no count; their
 * single map holds every id ever issued, so ids are read until the first miss.
 */
export async function readWithdrawals(maxIds = 2_000): Promise<WithdrawalReading[]> {
  const id = config.contracts.stakingContractId;
  const out: WithdrawalReading[] = [];

  let count: number | null = null;
  try {
    count = Number(await view(id, "withdrawal_count"));
  } catch (err) {
    if (!(err instanceof ContractCallError)) throw err;
    count = null; // before version 3: no such view
  }

  const limit = Math.min(count ?? maxIds, maxIds);
  for (let i = 0; i < limit; i++) {
    try {
      const r = (await view(id, "get_withdrawal", [nativeToScVal(i, { type: "u64" })])) as RawWithdrawal;
      out.push(toReading(r));
    } catch (err) {
      if (!(err instanceof ContractCallError)) throw err; // outage, not a missing id
      if (count === null) break; // legacy map: first miss is the end
    }
  }
  return out;
}
