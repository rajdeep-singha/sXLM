import { describe, it, expect } from "vitest";
import { submitAndConfirm, TransactionRejected, type SubmitDeps } from "../src/stellar/submit.js";
import { dexMidPrice } from "../src/metrics-cron/index.js";

const fast = { attempts: 3, busyRetries: 3, pollIntervalMs: 1, pollLimit: 4 };

/** Scripted RPC: each build gets a new hash; answers are popped in order. */
function rpc(sendAnswers: string[], statusAnswers: Record<string, string[]>) {
  let builds = 0;
  const sent: string[] = [];
  const deps: SubmitDeps = {
    build: async () => {
      builds += 1;
      return { xdr: `xdr${builds}`, hash: `hash${builds}` };
    },
    send: async (xdr) => {
      sent.push(xdr);
      return { status: sendAnswers.shift() ?? "PENDING", errorResultXdr: "AAAA" };
    },
    status: async (hash) => ({ status: statusAnswers[hash]?.shift() ?? "NOT_FOUND", ledger: 42 }),
    sleep: async () => {},
  };
  return { deps, sent, builds: () => builds };
}

describe("submitAndConfirm", () => {
  it("waits for a pending transaction to succeed", async () => {
    const r = rpc(["PENDING"], { hash1: ["NOT_FOUND", "SUCCESS"] });
    await expect(submitAndConfirm(r.deps, fast)).resolves.toEqual({ hash: "hash1", ledger: 42, attempts: 1 });
  });

  it("resends the same envelope on TRY_AGAIN_LATER", async () => {
    const r = rpc(["TRY_AGAIN_LATER", "TRY_AGAIN_LATER", "PENDING"], { hash1: ["SUCCESS"] });
    const out = await submitAndConfirm(r.deps, fast);
    expect(out.hash).toBe("hash1");
    expect(r.sent).toEqual(["xdr1", "xdr1", "xdr1"]);
    expect(r.builds()).toBe(1);
  });

  it("treats DUPLICATE as accepted", async () => {
    const r = rpc(["DUPLICATE"], { hash1: ["SUCCESS"] });
    await expect(submitAndConfirm(r.deps, fast)).resolves.toMatchObject({ hash: "hash1" });
  });

  it("rebuilds with a fresh sequence when an accepted transaction never appears", async () => {
    // The production failure: accepted, then NOT_FOUND for the whole wait.
    const r = rpc(["PENDING", "PENDING"], { hash1: [], hash2: ["SUCCESS"] });
    const out = await submitAndConfirm(r.deps, fast);
    expect(out).toMatchObject({ hash: "hash2", attempts: 2 });
  });

  it("rebuilds when a node stays busy", async () => {
    const r = rpc(["TRY_AGAIN_LATER", "TRY_AGAIN_LATER", "TRY_AGAIN_LATER", "TRY_AGAIN_LATER", "PENDING"], {
      hash2: ["SUCCESS"],
    });
    await expect(submitAndConfirm(r.deps, fast)).resolves.toMatchObject({ hash: "hash2", attempts: 2 });
  });

  it("stops at once on ERROR and on FAILED", async () => {
    await expect(submitAndConfirm(rpc(["ERROR"], {}).deps, fast)).rejects.toBeInstanceOf(TransactionRejected);
    await expect(submitAndConfirm(rpc(["PENDING"], { hash1: ["FAILED"] }).deps, fast)).rejects.toThrow(
      "failed in ledger 42"
    );
  });

  it("gives up with a history after the last attempt", async () => {
    const r = rpc(["PENDING", "PENDING", "PENDING"], {});
    await expect(submitAndConfirm(r.deps, fast)).rejects.toThrow("not confirmed after 3 attempts");
    expect(r.builds()).toBe(3);
  });

  it("keeps polling through a failed status request", async () => {
    const r = rpc(["PENDING"], {});
    let calls = 0;
    r.deps.status = async () => {
      calls += 1;
      if (calls === 1) throw new Error("all endpoints failed");
      return { status: "SUCCESS", ledger: 7 };
    };
    await expect(submitAndConfirm(r.deps, fast)).resolves.toMatchObject({ ledger: 7 });
  });
});

describe("DEX price", () => {
  it("takes the midpoint of the top of the XLM/USDC book", () => {
    const p = dexMidPrice({ bids: [{ price: "0.1220555" }], asks: [{ price: "0.1222139" }] });
    expect(p).toBeCloseTo(0.1221347, 6);
  });

  it("refuses an empty, crossed or very wide book", () => {
    expect(dexMidPrice({ bids: [], asks: [{ price: "0.12" }] })).toBeNull();
    expect(dexMidPrice({ bids: [{ price: "0.13" }], asks: [{ price: "0.12" }] })).toBeNull();
    expect(dexMidPrice({ bids: [{ price: "0.10" }], asks: [{ price: "0.12" }] })).toBeNull();
  });
});
