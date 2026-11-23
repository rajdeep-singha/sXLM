import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ALERT_CATALOGUE,
  DEFAULT_THRESHOLDS as T,
  LEDGERS_PER_DAY,
  checkAdminActivity,
  checkKeeper,
  checkRateFall,
  checkStaleWithdrawals,
  checkTtl,
  checkUtilisation,
  utilisationBps,
  xlm,
  type Finding,
} from "../src/monitor/checks.js";
import { AlertState } from "../src/monitor/state.js";
import { deliver, formatSlack } from "../src/monitor/notify.js";

describe("the six SOW alerts plus solvency are all defined", () => {
  it("has a rule for every required alert", () => {
    expect(Object.keys(ALERT_CATALOGUE).sort()).toEqual(
      [
        "admin_activity",
        "keeper_silent",
        "rate_fall",
        "solvency",
        "ttl_low",
        "utilisation_high",
        "withdrawal_stale",
      ].sort()
    );
  });
});

describe("rate_fall", () => {
  it("ignores the first reading and any rise", () => {
    expect(checkRateFall(null, 20_000_000n)).toEqual([]);
    expect(checkRateFall(20_000_000n, 20_000_000n)).toEqual([]);
    expect(checkRateFall(20_000_000n, 20_000_001n)).toEqual([]);
  });

  it("fires once on any fall, as an event", () => {
    const [f] = checkRateFall(20_321_760n, 20_321_759n);
    expect(f).toMatchObject({ name: "rate_fall", severity: "critical", event: true });
    expect(f?.message).toContain("2.0321760");
  });
});

describe("ttl_low", () => {
  const latest = 1_000_000;
  it("fires under 7 days, critical under 1 day, and names archived entries", () => {
    const findings = checkTtl(
      [
        { label: "vault instance", liveUntilLedger: latest + 8 * LEDGERS_PER_DAY },
        { label: "vault code", liveUntilLedger: latest + 6 * LEDGERS_PER_DAY },
        { label: "lending instance", liveUntilLedger: latest + 100 },
        { label: "lp code", liveUntilLedger: latest - 5 },
      ],
      latest,
      T
    );
    expect(findings.map((f) => [f.key, f.severity])).toEqual([
      ["vault code", "warning"],
      ["lending instance", "critical"],
      ["lp code", "critical"],
    ]);
    expect(findings[2]?.message).toContain("archived");
  });

  it("is quiet at exactly 7 days", () => {
    expect(checkTtl([{ label: "x", liveUntilLedger: latest + T.ttlMinLedgers }], latest, T)).toEqual([]);
  });
});

describe("keeper_silent", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  const account = "GKEEPER";

  it("is quiet when the keeper ran recently and has funds", () => {
    expect(
      checkKeeper({ lastTxAt: new Date("2026-11-24T06:00:00Z"), balanceStroops: 10_0000000n, account }, now, T)
    ).toEqual([]);
  });

  it("fires after 12 hours of silence", () => {
    const [f] = checkKeeper(
      { lastTxAt: new Date("2026-11-23T23:59:00Z"), balanceStroops: 10_0000000n, account },
      now,
      T
    );
    expect(f).toMatchObject({ name: "keeper_silent", key: "silence" });
    expect(f?.message).toContain("12.0 hours");
  });

  it("fires when the keeper has never run, is low on XLM, or does not exist", () => {
    const keys = checkKeeper({ lastTxAt: null, balanceStroops: 1_0000000n, account }, now, T).map((f) => f.key);
    expect(keys).toEqual(["silence", "balance"]);
    const [missing] = checkKeeper({ lastTxAt: null, balanceStroops: null, account }, now, T);
    expect(missing).toMatchObject({ key: "account", severity: "critical" });
  });
});

describe("utilisation_high", () => {
  it("computes reserve utilisation", () => {
    expect(utilisationBps(0n, 0n)).toBe(0);
    expect(utilisationBps(62_698_709n, 7_999_969n)).toBe(8_868);
  });

  it("fires above 85%, critical from the 90% cap", () => {
    expect(checkUtilisation({ totalBorrowed: 85n, poolBalance: 15n }, T)).toEqual([]);
    expect(checkUtilisation({ totalBorrowed: 86n, poolBalance: 14n }, T)[0]?.severity).toBe("warning");
    expect(checkUtilisation({ totalBorrowed: 90n, poolBalance: 10n }, T)[0]?.severity).toBe("critical");
  });

  it("reports mainnet as it stood on 2026-11-24", () => {
    const [f] = checkUtilisation({ totalBorrowed: 62_698_709n, poolBalance: 7_999_969n }, T);
    expect(f?.message).toContain("88.68%");
  });
});

describe("admin_activity", () => {
  it("raises one event per admin-signed operation", () => {
    const findings = checkAdminActivity(
      [
        { id: "1", createdAt: "t1", type: "set_options", txHash: "aa" },
        { id: "2", createdAt: "t2", type: "invoke_host_function", txHash: "bb" },
      ],
      "GADMIN"
    );
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.event && f.name === "admin_activity")).toBe(true);
    expect(findings[0]?.message).toContain("set_options");
  });
});

describe("withdrawal_stale", () => {
  const latest = 65_634_706;
  it("fires for unclaimed requests 30+ days past unlock, never for claimed ones", () => {
    const findings = checkStaleWithdrawals(
      [
        { id: 0, user: "A", xlmAmount: 10_000_000n, unlockLedger: 61_544_287, claimed: true },
        { id: 1, user: "A", xlmAmount: 9_848_024n, unlockLedger: 61_727_056, claimed: false },
        { id: 5, user: "B", xlmAmount: 1n, unlockLedger: latest - 29 * LEDGERS_PER_DAY, claimed: false },
      ],
      latest,
      T
    );
    expect(findings.map((f) => f.key)).toEqual(["1"]);
    expect(findings[0]?.message).toContain("226 days");
  });
});

describe("alert state", () => {
  const f = (name: Finding["name"], key: string, extra: Partial<Finding> = {}): Finding => ({
    name,
    key,
    severity: "warning",
    message: `${name} ${key}`,
    ...extra,
  });
  const ran = (...names: string[]) => new Set(names);

  it("fires once, reminds daily, resolves when cleared", () => {
    const s = new AlertState(24 * 3_600_000);
    expect(s.update([f("utilisation_high", "lending")], 0, ran("utilisation_high")).map((t) => t.kind)).toEqual([
      "fire",
    ]);
    expect(s.update([f("utilisation_high", "lending")], 3_600_000, ran("utilisation_high"))).toEqual([]);
    expect(
      s.update([f("utilisation_high", "lending")], 24 * 3_600_000, ran("utilisation_high")).map((t) => t.kind)
    ).toEqual(["remind"]);
    expect(s.update([], 25 * 3_600_000, ran("utilisation_high")).map((t) => t.kind)).toEqual(["resolve"]);
    expect(s.activeFindings()).toEqual([]);
  });

  it("does not resolve a condition whose check could not run", () => {
    const s = new AlertState(1_000);
    s.update([f("ttl_low", "vault code")], 0, ran("ttl_low"));
    const t = s.update([f("check_failed", "ttl_low")], 10, ran());
    expect(t.map((x) => [x.kind, x.finding.name])).toEqual([["fire", "check_failed"]]);
    expect(s.activeFindings().map((x) => x.name).sort()).toEqual(["check_failed", "ttl_low"]);

    // The check recovers: its failure clears, and so does the condition.
    const back = s.update([], 20, ran("ttl_low"));
    expect(back.map((x) => [x.kind, x.finding.name]).sort()).toEqual([
      ["resolve", "check_failed"],
      ["resolve", "ttl_low"],
    ]);
  });

  it("announces each event once", () => {
    const s = new AlertState(1_000);
    const ev = f("admin_activity", "op-1", { event: true });
    expect(s.update([ev], 0, ran("admin_activity"))).toHaveLength(1);
    expect(s.update([ev], 5_000, ran("admin_activity"))).toHaveLength(0);
  });
});

describe("delivery", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends Slack text and webhook JSON, and reports each result", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response("ok", { status: String(url).includes("slack") ? 200 : 500 });
    });
    const finding = f2();
    const results = await deliver(finding, "test", { slack: "https://hooks.slack.test/x", webhook: "https://alerts.test/y" });
    expect(results).toEqual([
      { destination: "slack", ok: true, status: 200 },
      { destination: "webhook", ok: false, status: 500 },
    ]);
    expect((calls[0]?.body as { text: string }).text).toContain("[TEST] ttl_low");
    expect(calls[1]?.body).toMatchObject({ status: "test", name: "ttl_low", key: "vault code" });
  });

  it("reports a network failure instead of throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const [r] = await deliver(f2(), "firing", { slack: "https://hooks.slack.test/x", webhook: "" });
    expect(r).toMatchObject({ destination: "slack", ok: false, error: "fetch failed" });
  });

  it("formats resolution distinctly", () => {
    expect(formatSlack(f2(), "resolved")).toContain("[RESOLVED]");
    expect(xlm(-12_345n)).toBe("-0.0012345");
  });

  function f2(): Finding {
    return { name: "ttl_low", key: "vault code", severity: "warning", message: "m" };
  }
});
