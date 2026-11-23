/**
 * Alert tooling.
 *
 *   npm run alerts -- check              run every check once against the chain, print findings
 *   npm run alerts -- test-fire [name]   send a [TEST] alert for one rule, or all of them
 *
 * `check` sends nothing. `test-fire` sends to the configured destinations
 * (SLACK_WEBHOOK_URL, ALERT_WEBHOOK_URL) and prints what each returned, which
 * is the evidence that an alert actually reaches someone.
 */

import { ALERT_CATALOGUE, type AlertName, type Finding } from "./checks.js";
import { deliver } from "./notify.js";
import { Monitor } from "./index.js";

async function testFire(only?: string): Promise<boolean> {
  const names = Object.keys(ALERT_CATALOGUE) as Exclude<AlertName, "check_failed">[];
  const selected = only && only !== "all" ? names.filter((n) => n === only) : names;
  if (selected.length === 0) {
    console.error(`Unknown alert "${only}". Known: ${names.join(", ")}`);
    return false;
  }

  let allOk = true;
  for (const name of selected) {
    const finding: Finding = {
      name,
      key: "test",
      severity: "warning",
      message: `Test fire at ${new Date().toISOString()}. Triggers on: ${ALERT_CATALOGUE[name]}.`,
    };
    const results = await deliver(finding, "test");
    if (results.length === 0) {
      console.log(`${name}: no destination configured`);
      allOk = false;
      continue;
    }
    for (const r of results) {
      console.log(`${name} -> ${r.destination}: ${r.ok ? "delivered" : "FAILED"} ${r.status ?? r.error ?? ""}`);
      allOk &&= r.ok;
    }
  }
  return allOk;
}

async function check(): Promise<void> {
  const monitor = new Monitor();
  const result = await monitor.evaluate();
  console.log(`Checks run at ${result.at}: ${result.checksRun.sort().join(", ")}`);
  if (result.findings.length === 0) {
    console.log("No findings.");
    return;
  }
  for (const f of result.findings) {
    console.log(`\n[${f.severity.toUpperCase()}] ${f.name}/${f.key}\n  ${f.message}`);
  }
}

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);
  if (command === "test-fire") {
    process.exit((await testFire(arg)) ? 0 : 1);
  } else if (command === "check") {
    await check();
  } else {
    console.error("usage: alerts <check | test-fire [name|all]>");
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
