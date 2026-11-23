import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  Failover,
  createFailoverRpc,
  horizonGet,
  isTransportError,
  rpcRequest,
} from "../src/stellar/network.js";

type Handler = (body: string, path: string) => { status: number; json?: unknown } | "hangup";

interface FakeEndpoint {
  url: string;
  hits: number;
  close: () => Promise<void>;
}

async function endpoint(handler: Handler): Promise<FakeEndpoint> {
  const state = { hits: 0 };
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      state.hits += 1;
      const out = handler(body, req.url ?? "/");
      if (out === "hangup") {
        req.socket.destroy();
        return;
      }
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.json ?? {}));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    get hits() {
      return state.hits;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** A port nothing listens on: connection refused. */
async function deadUrl(): Promise<string> {
  const e = await endpoint(() => ({ status: 200 }));
  await e.close();
  return e.url;
}

const healthy = (body: string) => {
  const { id } = JSON.parse(body) as { id: number };
  return {
    status: 200,
    json: { jsonrpc: "2.0", id, result: { status: "healthy", latestLedger: 123, oldestLedger: 1, ledgerRetentionWindow: 10 } },
  };
};

describe("transport error classification", () => {
  it("treats refused connections, timeouts, 5xx and 429 as transport failures", () => {
    expect(isTransportError({ code: "ECONNREFUSED" })).toBe(true);
    expect(isTransportError({ name: "TimeoutError" })).toBe(true);
    expect(isTransportError({ response: { status: 503 } })).toBe(true);
    expect(isTransportError({ status: 429 })).toBe(true);
    expect(isTransportError(new TypeError("fetch failed"))).toBe(true);
    expect(isTransportError({ message: "x", cause: { code: "ECONNRESET" } })).toBe(true);
  });

  it("treats answers from a healthy endpoint as final", () => {
    expect(isTransportError(new Error("Account not found: GABC"))).toBe(false);
    expect(isTransportError({ response: { status: 404 } })).toBe(false);
    expect(isTransportError(new Error("RPC error: invalid params"))).toBe(false);
  });
});

describe("Failover", () => {
  it("skips a failed endpoint for the cooldown, then tries it again", async () => {
    let t = 0;
    const f = new Failover("test", ["a", "b"], 1_000, () => t);
    const calls: string[] = [];
    const result = await f.run(async (url) => {
      calls.push(url);
      if (url === "a") throw Object.assign(new Error("down"), { code: "ECONNREFUSED" });
      return url;
    });
    expect(result).toBe("b");
    expect(f.order()).toEqual(["b", "a"]);
    expect(f.status()[0]).toMatchObject({ url: "a", healthy: false, failures: 1 });

    t = 1_001;
    expect(f.order()).toEqual(["a", "b"]);
    expect(calls).toEqual(["a", "b"]);
  });

  it("does not retry an answer, only a transport failure", async () => {
    const f = new Failover("test", ["a", "b"]);
    const calls: string[] = [];
    await expect(
      f.run(async (url) => {
        calls.push(url);
        throw new Error("Account not found");
      })
    ).rejects.toThrow("Account not found");
    expect(calls).toEqual(["a"]);
  });

  it("reports when every endpoint is down", async () => {
    const f = new Failover("test", ["a", "b"]);
    await expect(
      f.run(async () => {
        throw Object.assign(new Error("down"), { code: "ETIMEDOUT" });
      })
    ).rejects.toThrow("all endpoints failed");
  });
});

describe("RPC failover against live HTTP endpoints", () => {
  let failing: FakeEndpoint;
  let hangup: FakeEndpoint;
  let good: FakeEndpoint;
  let answersWithError: FakeEndpoint;
  let dead: string;

  beforeAll(async () => {
    dead = await deadUrl();
    failing = await endpoint(() => ({ status: 503, json: { error: "maintenance" } }));
    hangup = await endpoint(() => "hangup");
    good = await endpoint(healthy);
    answersWithError = await endpoint((body) => ({
      status: 200,
      json: { jsonrpc: "2.0", id: JSON.parse(body).id, error: { code: -32602, message: "invalid params" } },
    }));
  });

  afterAll(async () => {
    await Promise.all([failing, hangup, good, answersWithError].map((e) => e.close()));
  });

  it("an SDK call completes on the fallback when the primary is refused, failing and hanging up", async () => {
    const server = createFailoverRpc([dead, failing.url, hangup.url, good.url], "test-rpc");
    const health = await server.getHealth();
    expect(health.status).toBe("healthy");
    expect(health.latestLedger).toBe(123);
    expect(good.hits).toBeGreaterThan(0);
    const status = server.failover.status();
    expect(status.filter((s) => !s.healthy).map((s) => s.url)).toEqual([dead, failing.url, hangup.url]);
  });

  it("a raw JSON-RPC request fails over the same way", async () => {
    const f = new Failover("test-raw", [dead, failing.url, good.url]);
    const result = await rpcRequest<{ status: string }>("getHealth", undefined, f);
    expect(result.status).toBe("healthy");
  });

  it("an error answer is returned, not retried elsewhere", async () => {
    const before = good.hits;
    const f = new Failover("test-answer", [answersWithError.url, good.url]);
    await expect(rpcRequest("getHealth", undefined, f)).rejects.toThrow("invalid params");
    expect(good.hits).toBe(before);
  });
});

describe("Horizon failover", () => {
  let down: FakeEndpoint;
  let up: FakeEndpoint;

  beforeAll(async () => {
    down = await endpoint(() => ({ status: 502 }));
    up = await endpoint((_b, path) => ({ status: 200, json: { path, history_latest_ledger: 99 } }));
  });

  afterAll(async () => {
    await Promise.all([down.close(), up.close()]);
  });

  it("reads from the fallback when the primary returns 502", async () => {
    const f = new Failover("test-horizon", [down.url, up.url]);
    const root = await horizonGet<{ path: string; history_latest_ledger: number }>("/", f);
    expect(root.history_latest_ledger).toBe(99);
    expect(down.hits).toBe(1);
  });

  it("a 404 is an answer, not an outage", async () => {
    const notFound = await endpoint(() => ({ status: 404, json: { status: 404 } }));
    const f = new Failover("test-404", [notFound.url, up.url]);
    const before = up.hits;
    await expect(horizonGet("/accounts/G", f)).rejects.toThrow("Horizon 404");
    expect(up.hits).toBe(before);
    await notFound.close();
  });
});
