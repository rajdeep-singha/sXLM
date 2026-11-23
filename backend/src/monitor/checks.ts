/**
 * Production alert rules.
 *
 * Each rule is a pure function from readings to findings, so every threshold
 * is unit-tested without a network. `sources.ts` takes the readings from the
 * chain; `index.ts` runs the rules on a schedule and delivers what they find.
 */

export type AlertName =
  | "solvency"
  | "rate_fall"
  | "ttl_low"
  | "keeper_silent"
  | "utilisation_high"
  | "admin_activity"
  | "withdrawal_stale"
  | "check_failed";

export type Severity = "critical" | "warning";

export interface Finding {
  name: AlertName;
  /** Distinguishes findings of one rule: a contract, a request id, a tx. */
  key: string;
  severity: Severity;
  message: string;
  /** Fires once per occurrence instead of staying active until resolved. */
  event?: boolean;
}

/** Ledgers close about every 5 seconds. */
export const LEDGERS_PER_DAY = 17_280;

export interface Thresholds {
  ttlMinLedgers: number;
  keeperSilenceMs: number;
  keeperMinBalanceStroops: bigint;
  utilisationBps: number;
  withdrawalStaleLedgers: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  ttlMinLedgers: 7 * LEDGERS_PER_DAY,
  keeperSilenceMs: 12 * 60 * 60 * 1000,
  keeperMinBalanceStroops: BigInt(2_0000000),
  utilisationBps: 8_500,
  withdrawalStaleLedgers: 30 * LEDGERS_PER_DAY,
};

/** Every alert the monitor can raise, with what triggers it. */
export const ALERT_CATALOGUE: Record<Exclude<AlertName, "check_failed">, string> = {
  solvency: "Vault holds less XLM than share claims, queued withdrawals and fees combined",
  rate_fall: "sXLM exchange rate lower than the previous reading",
  ttl_low: "A contract instance or its code has under 7 days of TTL left",
  keeper_silent: "No keeper transaction in 12 hours, or keeper balance under 2 XLM",
  utilisation_high: "Lending reserve utilisation above 85%",
  admin_activity: "Any operation signed by the admin account",
  withdrawal_stale: "A queued withdrawal unclaimed 30 days after its unlock ledger",
};

export function xlm(stroops: bigint): string {
  const neg = stroops < BigInt(0);
  const abs = neg ? -stroops : stroops;
  const whole = abs / BigInt(10_000_000);
  const frac = (abs % BigInt(10_000_000)).toString().padStart(7, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export function checkSolvency(r: {
  idle: bigint;
  pending: bigint;
  treasury: bigint;
  assets: bigint;
}): Finding[] {
  const owed = r.assets + r.pending + r.treasury;
  const shortfall = owed - r.idle;
  if (shortfall <= BigInt(0)) return [];
  return [
    {
      name: "solvency",
      key: "vault",
      severity: "critical",
      message:
        `Vault holds ${xlm(r.idle)} XLM but owes ${xlm(owed)} XLM ` +
        `(shares ${xlm(r.assets)}, queued ${xlm(r.pending)}, fees ${xlm(r.treasury)}); ` +
        `short ${xlm(shortfall)} XLM. Pause the vault through the admin multisig.`,
    },
  ];
}

/** Rate is scaled by 1e7. Any fall is a loss: users cannot cause one. */
export function checkRateFall(previous: bigint | null, current: bigint): Finding[] {
  if (previous === null || current >= previous) return [];
  return [
    {
      name: "rate_fall",
      key: `${previous}->${current}`,
      severity: "critical",
      event: true,
      message:
        `sXLM exchange rate fell from ${xlm(previous)} to ${xlm(current)} XLM. ` +
        `With no strategies deployed there is no legitimate cause.`,
    },
  ];
}

export interface TtlReading {
  /** e.g. "vault instance", "vault code". */
  label: string;
  liveUntilLedger: number;
}

export function checkTtl(entries: TtlReading[], latestLedger: number, t: Thresholds): Finding[] {
  return entries
    .filter((e) => e.liveUntilLedger - latestLedger < t.ttlMinLedgers)
    .map((e) => {
      const left = e.liveUntilLedger - latestLedger;
      const days = (left / LEDGERS_PER_DAY).toFixed(1);
      return {
        name: "ttl_low" as const,
        key: e.label,
        severity: (left < LEDGERS_PER_DAY ? "critical" : "warning") as Severity,
        message:
          left <= 0
            ? `${e.label} is archived (expired at ledger ${e.liveUntilLedger}). Restore it before it can be called.`
            : `${e.label} has ${days} days of TTL left (until ledger ${e.liveUntilLedger}). ` +
              `Run bump_instance; the keeper should be doing this daily.`,
      };
    });
}

export function checkKeeper(
  r: { lastTxAt: Date | null; balanceStroops: bigint | null; account: string },
  now: Date,
  t: Thresholds
): Finding[] {
  const out: Finding[] = [];
  if (r.balanceStroops === null) {
    out.push({
      name: "keeper_silent",
      key: "account",
      severity: "critical",
      message: `Keeper account ${r.account} does not exist on the network.`,
    });
    return out;
  }
  const silentFor = r.lastTxAt ? now.getTime() - r.lastTxAt.getTime() : Infinity;
  if (silentFor > t.keeperSilenceMs) {
    out.push({
      name: "keeper_silent",
      key: "silence",
      severity: "warning",
      message: r.lastTxAt
        ? `Keeper ${r.account} last sent a transaction ${(silentFor / 3_600_000).toFixed(1)} hours ago ` +
          `(${r.lastTxAt.toISOString()}). Check RUN_AUTOMATION and KEEPER_SECRET_KEY on the backend.`
        : `Keeper ${r.account} has never sent a transaction. Check RUN_AUTOMATION and KEEPER_SECRET_KEY on the backend.`,
    });
  }
  if (r.balanceStroops < t.keeperMinBalanceStroops) {
    out.push({
      name: "keeper_silent",
      key: "balance",
      severity: "warning",
      message: `Keeper ${r.account} holds ${xlm(r.balanceStroops)} XLM; top it up before fees run out.`,
    });
  }
  return out;
}

/** Share of the lending reserve currently lent out. */
export function utilisationBps(totalBorrowed: bigint, poolBalance: bigint): number {
  const reserve = totalBorrowed + poolBalance;
  if (reserve <= BigInt(0)) return 0;
  return Number((totalBorrowed * BigInt(10_000)) / reserve);
}

export function checkUtilisation(
  r: { totalBorrowed: bigint; poolBalance: bigint },
  t: Thresholds
): Finding[] {
  const bps = utilisationBps(r.totalBorrowed, r.poolBalance);
  if (bps <= t.utilisationBps) return [];
  return [
    {
      name: "utilisation_high",
      key: "lending",
      severity: bps >= 9_000 ? "critical" : "warning",
      message:
        `Lending reserve ${(bps / 100).toFixed(2)}% utilised: ${xlm(r.totalBorrowed)} XLM lent, ` +
        `${xlm(r.poolBalance)} XLM left. At the 90% cap borrowing stops and suppliers cannot exit.`,
    },
  ];
}

export interface AdminOperation {
  id: string;
  createdAt: string;
  type: string;
  txHash: string;
}

export function checkAdminActivity(ops: AdminOperation[], admin: string): Finding[] {
  return ops.map((op) => ({
    name: "admin_activity" as const,
    key: op.id,
    severity: "warning" as const,
    event: true,
    message:
      `Admin account ${admin} signed a ${op.type} operation at ${op.createdAt} ` +
      `(tx ${op.txHash}). Confirm it matches a planned signing session.`,
  }));
}

export interface WithdrawalReading {
  id: number;
  user: string;
  xlmAmount: bigint;
  unlockLedger: number;
  claimed: boolean;
}

export function checkStaleWithdrawals(
  requests: WithdrawalReading[],
  latestLedger: number,
  t: Thresholds
): Finding[] {
  return requests
    .filter((r) => !r.claimed && latestLedger - r.unlockLedger > t.withdrawalStaleLedgers)
    .map((r) => ({
      name: "withdrawal_stale" as const,
      key: String(r.id),
      severity: "warning" as const,
      message:
        `Withdrawal #${r.id} of ${xlm(r.xlmAmount)} XLM for ${r.user} has been claimable for ` +
        `${Math.floor((latestLedger - r.unlockLedger) / LEDGERS_PER_DAY)} days and is still unclaimed.`,
    }));
}
