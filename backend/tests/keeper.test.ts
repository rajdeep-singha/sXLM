import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import { loadKeeperKeypair } from "../src/keeper/keys.js";
import { KEEPER_METHODS } from "../src/keeper/index.js";
import { assessSolvency } from "../src/risk-engine/index.js";

const CONTRACTS_DIR = fileURLToPath(new URL("../../contracts", import.meta.url));

/** Body of every `pub fn <name>(` across the contract sources. */
function contractFunctionBodies(name: string): string[] {
  const bodies: string[] = [];
  for (const dir of readdirSync(CONTRACTS_DIR)) {
    const path = join(CONTRACTS_DIR, dir, "src", "lib.rs");
    if (!existsSync(path)) continue;
    const src = readFileSync(path, "utf8");
    // Production code only: stop at the test module.
    const prod = src.split("#[cfg(test)]")[0] ?? src;
    const re = new RegExp(`pub fn ${name}\\(`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(prod)) !== null) {
      const rest = prod.slice(m.index + 1);
      const next = rest.search(/\n {4}pub fn /);
      bodies.push(next === -1 ? rest : rest.slice(0, next));
    }
  }
  return bodies;
}

describe("Keeper key", () => {
  const admin = Keypair.random().publicKey();

  it("refuses a missing key", () => {
    expect(() => loadKeeperKeypair("", admin)).toThrow(/not set/);
  });

  it("refuses a malformed key", () => {
    expect(() => loadKeeperKeypair("SNOTAKEY", admin)).toThrow(/not a valid/);
  });

  it("refuses the admin key", () => {
    const adminKeypair = Keypair.random();
    expect(() =>
      loadKeeperKeypair(adminKeypair.secret(), adminKeypair.publicKey())
    ).toThrow(/admin key/);
  });

  it("accepts a separate key", () => {
    const keeper = Keypair.random();
    expect(loadKeeperKeypair(keeper.secret(), admin).publicKey()).toBe(keeper.publicKey());
  });
});

describe("Keeper calls", () => {
  it("can tell an admin-gated method apart (control)", () => {
    const bodies = contractFunctionBodies("pause");
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.some((b) => /require_auth/.test(b))).toBe(true);
  });

  it("only calls methods that exist and need no authorisation", () => {
    for (const method of KEEPER_METHODS) {
      const bodies = contractFunctionBodies(method);
      expect(bodies.length, `${method} exists in a contract`).toBeGreaterThan(0);
      for (const body of bodies) {
        expect(body, `${method} must be permissionless`).not.toMatch(/require_auth/);
      }
    }
  });

  it("does not move money through its own account", () => {
    const methods: readonly string[] = KEEPER_METHODS;
    for (const forbidden of ["add_rewards", "withdraw_fees", "pause", "unpause", "harvest_interest"]) {
      expect(methods).not.toContain(forbidden);
    }
  });
});

describe("Solvency assessment", () => {
  it("reports no shortfall when holdings cover obligations", () => {
    const r = assessSolvency({ idle: 100n, assets: 80n, pending: 15n, treasury: 5n });
    expect(r.liabilities).toBe(100n);
    expect(r.shortfall).toBe(0n);
  });

  it("reports the gap when obligations exceed holdings", () => {
    const r = assessSolvency({ idle: 90n, assets: 80n, pending: 15n, treasury: 5n });
    expect(r.shortfall).toBe(10n);
  });
});
