/**
 * Admin multisig tooling.
 *
 *   npm run multisig -- check  <plan.json>   validate the plan, offline
 *   npm run multisig -- build  <plan.json>   print the unsigned conversion transaction (XDR)
 *   npm run multisig -- verify <plan.json>   compare the account on chain with the plan
 *
 * The network comes from STELLAR_HORIZON_URL and STELLAR_NETWORK_PASSPHRASE.
 * Rehearse on testnet first. This tool never signs or submits anything:
 * the XDR from `build` is signed with the current admin key offline and
 * submitted by hand (docs/OPERATIONS.md, "Admin multisig").
 */

import { readFileSync } from "node:fs";
import { Account, Horizon } from "@stellar/stellar-sdk";
import { config } from "../config/index.js";
import {
  buildConversionTransaction,
  checkAccountMatchesPlan,
  validateMultisigPlan,
  type MultisigPlan,
} from "./plan.js";

function loadPlan(path: string | undefined): MultisigPlan {
  if (!path) {
    throw new Error("usage: multisig <check|build|verify> <plan.json>");
  }
  return JSON.parse(readFileSync(path, "utf8")) as MultisigPlan;
}

function printPlan(plan: MultisigPlan): void {
  const total = plan.signers.reduce((sum, s) => sum + s.weight, 0);
  console.log(`Network:   ${config.stellar.networkPassphrase}`);
  console.log(`Admin:     ${plan.adminPublicKey}`);
  console.log(`Threshold: ${plan.threshold} of ${total}`);
  for (const s of plan.signers) {
    console.log(`Signer:    ${s.publicKey} (weight ${s.weight})`);
  }
}

async function main(): Promise<void> {
  const [command, path] = process.argv.slice(2);
  const plan = loadPlan(path);
  printPlan(plan);

  const errors = validateMultisigPlan(plan);
  if (errors.length > 0) {
    console.error(`\nPlan is invalid:\n- ${errors.join("\n- ")}`);
    process.exit(1);
  }

  const horizon = new Horizon.Server(config.stellar.horizonUrl);

  switch (command) {
    case "check":
      console.log("\nPlan is valid.");
      return;

    case "build": {
      const loaded = await horizon.loadAccount(plan.adminPublicKey);
      const account = new Account(loaded.accountId(), loaded.sequenceNumber());
      const tx = buildConversionTransaction(account, plan, config.stellar.networkPassphrase);
      console.log(`\n${tx.operations.length} operations, valid for 1 hour. Unsigned XDR:\n`);
      console.log(tx.toXDR());
      return;
    }

    case "verify": {
      const loaded = await horizon.loadAccount(plan.adminPublicKey);
      const mismatches = checkAccountMatchesPlan(loaded, plan);
      if (mismatches.length > 0) {
        console.error(`\nAccount does not match the plan:\n- ${mismatches.join("\n- ")}`);
        process.exit(1);
      }
      console.log("\nAccount matches the plan.");
      return;
    }

    default:
      throw new Error("usage: multisig <check|build|verify> <plan.json>");
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
