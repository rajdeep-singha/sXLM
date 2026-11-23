import { rpc, Contract, TransactionBuilder, BASE_FEE, scValToNative } from '@stellar/stellar-sdk';
import { NETWORK, CONTRACTS } from '../config/contracts';

/**
 * Soroban RPC and Horizon reads with provider failover.
 *
 * Each call tries the configured endpoints in order and moves on when one is
 * unreachable or answers 5xx/429. An answer from a reachable endpoint, even an
 * error answer, is returned as is.
 */

// Known active mainnet account, used only as the source of read-only
// simulations, which need an existing account but no signature.
export const SIMULATION_SOURCE = 'GDWXTIIROGCVBSNQMBJFH6HOWQ4YSRVMKSUS53CH6MP56WSWD6J4VZ5N';

function isTransportError(err: unknown): boolean {
  const e = err as { response?: { status?: number }; status?: number; message?: string; name?: string };
  const status = e?.response?.status ?? e?.status;
  if (typeof status === 'number' && (status >= 500 || status === 429)) return true;
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return true;
  return /network error|timeout|failed to fetch|fetch failed|load failed|aborted/i.test(e?.message ?? '');
}

async function firstWorking<T>(urls: readonly string[], call: (url: string) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const url of urls) {
    try {
      return await call(url);
    } catch (err) {
      if (!isTransportError(err)) throw err;
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error('All network endpoints failed');
}

/** Run a call against a Soroban RPC server, failing over across providers. */
export function withRpc<T>(call: (server: rpc.Server) => Promise<T>): Promise<T> {
  return firstWorking(NETWORK.sorobanRpcUrls, (url) =>
    call(new rpc.Server(url, { allowHttp: url.startsWith('http://'), timeout: 15_000 })),
  );
}

/** GET a Horizon path (starting with "/"); null on 404. */
export function horizonGet<T>(path: string): Promise<T | null> {
  return firstWorking(NETWORK.horizonUrls, async (url) => {
    const res = await fetch(`${url.replace(/\/$/, '')}${path}`, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw Object.assign(new Error(`Horizon ${res.status}`), { status: res.status });
    return (await res.json()) as T;
  });
}

/** Simulate a read-only contract call and return its native value. */
export function readContract(contractId: string, method: string, args: Parameters<Contract['call']>[1][] = []): Promise<unknown> {
  return withRpc(async (server) => {
    const account = await server.getAccount(SIMULATION_SOURCE);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK.networkPassphrase })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
      return scValToNative(sim.result.retval);
    }
    throw new Error(`${method} simulation failed`);
  });
}

/** Withdrawal cooldown in ledgers, as enforced by the vault. */
export async function readCooldownLedgers(): Promise<number> {
  return Number(await readContract(CONTRACTS.staking, 'get_cooldown_period'));
}

/** "~10.5 days", "~6 hours": a ledger count in words, at ~5 s per ledger. */
export function describeLedgers(ledgers: number): string {
  const hours = (ledgers * 5) / 3600;
  if (hours >= 48) return `~${(hours / 24).toFixed(1).replace(/\.0$/, '')} days`;
  if (hours >= 1) return `~${Math.round(hours)} hours`;
  return `~${Math.max(1, Math.round(hours * 60))} minutes`;
}
