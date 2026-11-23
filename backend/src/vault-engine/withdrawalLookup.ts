import { Address, nativeToScVal } from "@stellar/stellar-sdk";
import { config } from "../config/index.js";
import { ContractCallError, view } from "../stellar/contracts.js";

export interface OpenWithdrawal {
  id: number;
  user: string;
  xlmAmount: bigint;
  unlockLedger: number;
}

interface RawWithdrawal {
  id: number | bigint;
  user: string;
  xlm_amount: number | bigint | string;
  unlock_ledger: number;
  claimed: boolean;
}

function toOpen(r: RawWithdrawal): OpenWithdrawal {
  return {
    id: Number(r.id),
    user: r.user,
    xlmAmount: BigInt(r.xlm_amount as string | number | bigint),
    unlockLedger: Number(r.unlock_ledger),
  };
}

/**
 * A user's open withdrawal requests, oldest first.
 *
 * Version 3 of the vault indexes them per account (`get_user_withdrawals`).
 * Earlier versions keep every request in one map with no index; there the ids
 * are read in order until the first that does not exist, which is the end of
 * that map. Both paths are needed while the backend runs ahead of the
 * contract upgrade.
 */
export async function openWithdrawalsFor(user: string, maxLegacyIds = 1_000): Promise<OpenWithdrawal[]> {
  const vault = config.contracts.stakingContractId;
  try {
    const list = (await view(vault, "get_user_withdrawals", [new Address(user).toScVal()])) as RawWithdrawal[];
    const open = list.filter((r) => !r.claimed).map(toOpen);
    // Requests still in a legacy map are not indexed until migrated.
    if (open.length > 0) return open;
    const legacy = Number(await view(vault, "legacy_queue_len"));
    if (legacy === 0) return open;
  } catch (err) {
    if (!(err instanceof ContractCallError)) throw err;
  }

  // Version 3 knows how many ids exist and leaves gaps where requests were
  // claimed; before it, the map holds every id ever issued, so the first miss
  // is the end.
  let count: number | null = null;
  try {
    count = Number(await view(vault, "withdrawal_count"));
  } catch (err) {
    if (!(err instanceof ContractCallError)) throw err;
  }

  const out: OpenWithdrawal[] = [];
  const limit = Math.min(count ?? maxLegacyIds, maxLegacyIds);
  for (let id = 0; id < limit; id++) {
    let r: RawWithdrawal;
    try {
      r = (await view(vault, "get_withdrawal", [nativeToScVal(id, { type: "u64" })])) as RawWithdrawal;
    } catch (err) {
      if (!(err instanceof ContractCallError)) throw err;
      if (count === null) break;
      continue;
    }
    if (r.user === user && !r.claimed) out.push(toOpen(r));
  }
  return out;
}

/**
 * Which request to claim: the one the caller named if it is theirs and open,
 * otherwise the oldest one already unlocked, otherwise the oldest (so the
 * caller can be told how long is left).
 */
export function pickWithdrawal(
  open: OpenWithdrawal[],
  latestLedger: number,
  preferredId?: number
): OpenWithdrawal | null {
  if (open.length === 0) return null;
  if (preferredId !== undefined) {
    const named = open.find((w) => w.id === preferredId);
    if (named) return named;
  }
  return open.find((w) => w.unlockLedger <= latestLedger) ?? open[0]!;
}
