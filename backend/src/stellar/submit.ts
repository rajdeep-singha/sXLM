/**
 * Submit a signed transaction and wait until it is in a ledger.
 *
 * Soroban RPC's sendTransaction answers one of four things, and each needs
 * different handling:
 *   PENDING          accepted into the queue: wait for it
 *   DUPLICATE        already submitted: wait for it
 *   TRY_AGAIN_LATER  not accepted (node busy, or another transaction from the
 *                    same account queued): resend the same envelope shortly
 *   ERROR            rejected: stop, with the reason
 *
 * A transaction that was accepted but never appears is rebuilt with a fresh
 * sequence number and sent again. That cannot apply twice: if the first one
 * lands late, both carry the same sequence number and only one is valid.
 */

export interface SignedTx {
  xdr: string;
  hash: string;
}

export interface SubmitDeps {
  /** Build, prepare and sign a transaction with the account's current sequence. */
  build(): Promise<SignedTx>;
  send(xdr: string): Promise<{ status: string; errorResultXdr?: string }>;
  status(hash: string): Promise<{ status: string; ledger?: number; resultXdr?: string }>;
  sleep(ms: number): Promise<void>;
}

export interface SubmitOptions {
  /** Fresh builds before giving up. */
  attempts: number;
  /** Resends of one envelope answered TRY_AGAIN_LATER. */
  busyRetries: number;
  pollIntervalMs: number;
  /** Polls of one hash before it is treated as dropped. */
  pollLimit: number;
}

export const DEFAULT_SUBMIT_OPTIONS: SubmitOptions = {
  attempts: 3,
  busyRetries: 5,
  pollIntervalMs: 2_000,
  pollLimit: 30,
};

export class TransactionRejected extends Error {}

export async function submitAndConfirm(
  deps: SubmitDeps,
  opts: SubmitOptions = DEFAULT_SUBMIT_OPTIONS
): Promise<{ hash: string; ledger?: number; attempts: number }> {
  const history: string[] = [];

  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    const tx = await deps.build();

    let accepted = false;
    for (let busy = 0; busy <= opts.busyRetries; busy++) {
      const sent = await deps.send(tx.xdr);
      if (sent.status === "PENDING" || sent.status === "DUPLICATE") {
        accepted = true;
        break;
      }
      if (sent.status === "ERROR") {
        throw new TransactionRejected(
          `transaction ${tx.hash} rejected: ${sent.errorResultXdr ?? "no result"}`
        );
      }
      // TRY_AGAIN_LATER, or anything unrecognised: back off and resend.
      history.push(`${tx.hash.slice(0, 8)} ${sent.status}`);
      await deps.sleep(opts.pollIntervalMs * (busy + 1));
    }
    if (!accepted) continue;

    for (let poll = 0; poll < opts.pollLimit; poll++) {
      await deps.sleep(opts.pollIntervalMs);
      let s: { status: string; ledger?: number; resultXdr?: string };
      try {
        s = await deps.status(tx.hash);
      } catch {
        continue; // every provider failed this poll; try again
      }
      if (s.status === "SUCCESS") return { hash: tx.hash, ledger: s.ledger, attempts: attempt };
      if (s.status === "FAILED") {
        throw new TransactionRejected(
          `transaction ${tx.hash} failed in ledger ${s.ledger ?? "?"}: ${s.resultXdr ?? "no result"}`
        );
      }
    }
    history.push(`${tx.hash.slice(0, 8)} never appeared`);
  }

  throw new Error(`transaction not confirmed after ${opts.attempts} attempts (${history.join("; ")})`);
}
