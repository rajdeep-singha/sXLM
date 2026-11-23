/**
 * Soroban RPC and Horizon access with provider failover.
 *
 * Every RPC and Horizon call in the backend goes through here. Endpoints are
 * tried in configured order. An endpoint that fails at the transport level
 * (connection refused, timeout, HTTP 5xx or 429) is skipped for a cooldown and
 * the call moves to the next one. An answer from a healthy endpoint, including
 * an error answer such as "account not found" or a failed simulation, is
 * returned as is: asking another provider the same question would only repeat
 * it.
 *
 * Resubmitting a signed transaction to a second provider is safe. The network
 * identifies it by hash and applies it at most once.
 */

import { Horizon, rpc } from "@stellar/stellar-sdk";
import { config } from "../config/index.js";

const DEFAULT_COOLDOWN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

const RETRIABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ERR_NETWORK",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
]);

const RETRIABLE_MESSAGE =
  /network error|timeout|timed out|fetch failed|socket hang up|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|aborted|terminated|HTTP 5\d\d|HTTP 429/i;

/** True when an error says the endpoint is unreachable or overloaded. */
export function isTransportError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    code?: string;
    name?: string;
    message?: string;
    status?: number;
    response?: { status?: number };
    cause?: unknown;
  };
  const status = e.response?.status ?? e.status;
  if (typeof status === "number" && (status >= 500 || status === 429)) return true;
  if (e.code && RETRIABLE_CODES.has(e.code)) return true;
  if (e.name === "AbortError" || e.name === "TimeoutError") return true;
  if (e.message && RETRIABLE_MESSAGE.test(e.message)) return true;
  if (e.cause && e.cause !== err) return isTransportError(e.cause);
  return false;
}

export interface EndpointStatus {
  url: string;
  healthy: boolean;
  failures: number;
  lastError?: string;
  lastErrorAt?: string;
  lastSuccessAt?: string;
}

/** An ordered list of interchangeable endpoints. */
export class Failover {
  private readonly state: Map<string, EndpointStatus & { skipUntil: number }>;

  constructor(
    readonly label: string,
    readonly urls: string[],
    private readonly cooldownMs = DEFAULT_COOLDOWN_MS,
    private readonly now: () => number = Date.now
  ) {
    if (urls.length === 0) throw new Error(`${label}: no endpoints configured`);
    this.state = new Map(
      urls.map((url) => [url, { url, healthy: true, failures: 0, skipUntil: 0 }])
    );
  }

  /** Healthy endpoints first, in configured order; cooling ones after. */
  order(): string[] {
    const t = this.now();
    const ready = this.urls.filter((u) => this.state.get(u)!.skipUntil <= t);
    const cooling = this.urls.filter((u) => this.state.get(u)!.skipUntil > t);
    return [...ready, ...cooling];
  }

  async run<T>(call: (url: string) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (const url of this.order()) {
      const s = this.state.get(url)!;
      try {
        const result = await call(url);
        s.healthy = true;
        s.failures = 0;
        s.skipUntil = 0;
        s.lastSuccessAt = new Date(this.now()).toISOString();
        return result;
      } catch (err) {
        if (!isTransportError(err)) throw err;
        lastErr = err;
        s.healthy = false;
        s.failures += 1;
        s.skipUntil = this.now() + this.cooldownMs;
        s.lastError = err instanceof Error ? err.message : String(err);
        s.lastErrorAt = new Date(this.now()).toISOString();
        console.warn(`[${this.label}] ${url} failed (${s.lastError}); trying next endpoint`);
      }
    }
    throw lastErr instanceof Error
      ? new Error(`${this.label}: all endpoints failed; last error: ${lastErr.message}`, {
          cause: lastErr,
        })
      : new Error(`${this.label}: all endpoints failed`);
  }

  status(): EndpointStatus[] {
    return this.urls.map((u) => {
      const { skipUntil: _skip, ...rest } = this.state.get(u)!;
      return { ...rest };
    });
  }
}

function serverOptions(url: string): rpc.Server.Options {
  return { allowHttp: url.startsWith("http://"), timeout: REQUEST_TIMEOUT_MS };
}

/**
 * An rpc.Server whose every method call fails over across the given URLs.
 * Drop-in for `new rpc.Server(url)`.
 */
export function createFailoverRpc(urls: string[], label = "rpc"): rpc.Server & { failover: Failover } {
  const failover = new Failover(label, urls);
  const servers = new Map(urls.map((u) => [u, new rpc.Server(u, serverOptions(u))]));
  const first = servers.get(urls[0]!)!;

  return new Proxy(first, {
    get(target, prop, receiver) {
      if (prop === "failover") return failover;
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        failover.run((url) => {
          const server = servers.get(url)!;
          const fn = (server as unknown as Record<PropertyKey, (...a: unknown[]) => unknown>)[prop];
          return Promise.resolve(fn!.apply(server, args));
        });
    },
  }) as rpc.Server & { failover: Failover };
}

/** Raw JSON-RPC request with failover, for callers that avoid SDK parsing. */
export async function rpcRequest<T>(
  method: string,
  params: unknown,
  failover: Failover = getRpc().failover
): Promise<T> {
  return failover.run(async (url) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status >= 500 || res.status === 429) {
      throw Object.assign(new Error(`HTTP ${res.status} from ${url}`), { status: res.status });
    }
    const body = (await res.json()) as { result?: T; error?: { code?: number; message?: string } };
    if (body.error) {
      throw Object.assign(new Error(`RPC error: ${body.error.message ?? "unknown"}`), {
        rpcCode: body.error.code,
      });
    }
    return body.result as T;
  });
}

/**
 * Latest ledger sequence, read without decoding the ledger header.
 *
 * The SDK's getLatestLedger parses the header XDR, which fails on protocol
 * versions newer than the SDK (seen on mainnet at protocol 30:
 * "LedgerHeader.scpValue.ext.v: unknown enum value 3"). Only the sequence is
 * needed, and it arrives as plain JSON.
 */
export async function latestLedgerSequence(failover?: Failover): Promise<number> {
  const result = await rpcRequest<{ sequence: number }>("getLatestLedger", undefined, failover);
  return Number(result.sequence);
}

/** Horizon GET with failover. `path` starts with "/". */
export async function horizonGet<T>(
  path: string,
  failover: Failover = getHorizonFailover()
): Promise<T> {
  return failover.run(async (url) => {
    const res = await fetch(`${url.replace(/\/$/, "")}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status >= 500 || res.status === 429) {
      throw Object.assign(new Error(`HTTP ${res.status} from ${url}`), { status: res.status });
    }
    if (!res.ok) {
      throw Object.assign(new Error(`Horizon ${res.status} for ${path}`), { status: res.status });
    }
    return (await res.json()) as T;
  });
}

/** Horizon account record with failover. */
export async function loadAccount(id: string): Promise<Horizon.AccountResponse> {
  return getHorizonFailover().run((url) =>
    new Horizon.Server(url, { allowHttp: url.startsWith("http://") }).loadAccount(id)
  );
}

let sharedRpc: (rpc.Server & { failover: Failover }) | null = null;
let sharedHorizon: Failover | null = null;

/** The backend's shared, failing-over RPC client. */
export function getRpc(): rpc.Server & { failover: Failover } {
  if (!sharedRpc) sharedRpc = createFailoverRpc(config.stellar.rpcUrls, "rpc");
  return sharedRpc;
}

export function getHorizonFailover(): Failover {
  if (!sharedHorizon) sharedHorizon = new Failover("horizon", config.stellar.horizonUrls);
  return sharedHorizon;
}

/** Endpoint health for /health and the RPC check command. */
export function networkStatus(): { rpc: EndpointStatus[]; horizon: EndpointStatus[] } {
  return { rpc: getRpc().failover.status(), horizon: getHorizonFailover().status() };
}
