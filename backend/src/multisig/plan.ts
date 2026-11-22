import {
  Account,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

/**
 * Converting the admin account to a multisig, in place.
 *
 * Every contract checks the admin with `require_auth`, and a classic Stellar
 * account satisfies that through its own signers and thresholds. Adding
 * signers, raising the thresholds and setting the master key's weight to 0
 * therefore puts all five contracts behind M-of-N with no contract change.
 *
 * A wrong set_options can lock the account for good, and with it every
 * contract's upgrade path, so nothing here builds a transaction from a plan
 * that fails validation.
 */

export interface MultisigSigner {
  publicKey: string;
  weight: number;
}

export interface MultisigPlan {
  /** The admin account being converted. */
  adminPublicKey: string;
  signers: MultisigSigner[];
  /** Signature weight required for every action: low, medium and high. */
  threshold: number;
  /** The keeper account, which must never be a signer. */
  keeperPublicKey?: string;
}

export function validateMultisigPlan(plan: MultisigPlan): string[] {
  const errors: string[] = [];

  if (!StrKey.isValidEd25519PublicKey(plan.adminPublicKey)) {
    errors.push(`admin is not a valid account address: ${plan.adminPublicKey}`);
  }

  if (plan.signers.length < 2) {
    errors.push("a multisig needs at least 2 signers");
  }

  const seen = new Set<string>();
  for (const s of plan.signers) {
    if (!StrKey.isValidEd25519PublicKey(s.publicKey)) {
      errors.push(`signer is not a valid account address: ${s.publicKey}`);
    }
    if (seen.has(s.publicKey)) {
      errors.push(`signer listed twice: ${s.publicKey}`);
    }
    seen.add(s.publicKey);
    if (s.publicKey === plan.adminPublicKey) {
      errors.push("the admin's own key cannot be a signer: its weight is set to 0");
    }
    if (plan.keeperPublicKey && s.publicKey === plan.keeperPublicKey) {
      errors.push("the keeper key cannot be a signer: it lives on a server");
    }
    if (!Number.isInteger(s.weight) || s.weight < 1 || s.weight > 255) {
      errors.push(`signer weight must be an integer from 1 to 255: ${s.publicKey}`);
    }
  }

  if (!Number.isInteger(plan.threshold) || plan.threshold < 2 || plan.threshold > 255) {
    errors.push("threshold must be an integer from 2 to 255");
  }

  const total = plan.signers.reduce((sum, s) => sum + s.weight, 0);
  if (total < plan.threshold) {
    errors.push(
      `signer weights total ${total}, below the threshold of ${plan.threshold}: the account would be locked`
    );
  }

  // Losing any one key must not lock the account.
  const heaviest = Math.max(0, ...plan.signers.map((s) => s.weight));
  if (total - heaviest < plan.threshold) {
    errors.push(
      "losing the heaviest signer's key would lock the account: add a signer or lower the threshold"
    );
  }

  // No single key may reach the threshold alone, or it is not a multisig.
  if (heaviest >= plan.threshold) {
    errors.push("one signer can act alone: every signer's weight must be below the threshold");
  }

  return errors;
}

/**
 * One transaction, signed by the current admin key alone: add each signer,
 * then raise every threshold and set the master key's weight to 0 in the last
 * operation. Signatures are checked against the account as it stands before
 * the transaction, so the master key can authorise its own removal.
 */
export function buildConversionTransaction(
  adminAccount: Account,
  plan: MultisigPlan,
  networkPassphrase: string,
  fee = "1000"
): Transaction {
  const errors = validateMultisigPlan(plan);
  if (errors.length > 0) {
    throw new Error(`refusing to build an invalid plan:\n- ${errors.join("\n- ")}`);
  }
  if (adminAccount.accountId() !== plan.adminPublicKey) {
    throw new Error("source account does not match the plan's admin account");
  }

  const builder = new TransactionBuilder(adminAccount, { fee, networkPassphrase });

  for (const s of plan.signers) {
    builder.addOperation(
      Operation.setOptions({ signer: { ed25519PublicKey: s.publicKey, weight: s.weight } })
    );
  }

  builder.addOperation(
    Operation.setOptions({
      masterWeight: 0,
      lowThreshold: plan.threshold,
      medThreshold: plan.threshold,
      highThreshold: plan.threshold,
    })
  );

  return builder.setTimeout(3600).build();
}

/** The parts of a Horizon account record this check reads. */
export interface AccountSigningState {
  thresholds: { low_threshold: number; med_threshold: number; high_threshold: number };
  signers: { key: string; weight: number; type: string }[];
}

/**
 * Compare the account on chain with the plan. An empty list means the
 * conversion landed exactly as planned.
 */
export function checkAccountMatchesPlan(state: AccountSigningState, plan: MultisigPlan): string[] {
  const errors: string[] = [];
  const t = state.thresholds;

  for (const [name, value] of [
    ["low", t.low_threshold],
    ["medium", t.med_threshold],
    ["high", t.high_threshold],
  ] as const) {
    if (value !== plan.threshold) {
      errors.push(`${name} threshold is ${value}, expected ${plan.threshold}`);
    }
  }

  const onChain = new Map(state.signers.map((s) => [s.key, s.weight]));

  const master = onChain.get(plan.adminPublicKey) ?? 0;
  if (master !== 0) {
    errors.push(`master key weight is ${master}, expected 0`);
  }

  for (const s of plan.signers) {
    const w = onChain.get(s.publicKey);
    if (w === undefined) {
      errors.push(`signer missing: ${s.publicKey}`);
    } else if (w !== s.weight) {
      errors.push(`signer ${s.publicKey} has weight ${w}, expected ${s.weight}`);
    }
  }

  const planned = new Set([plan.adminPublicKey, ...plan.signers.map((s) => s.publicKey)]);
  for (const s of state.signers) {
    if (!planned.has(s.key) && s.weight > 0) {
      errors.push(`unexpected signer with weight ${s.weight}: ${s.key}`);
    }
  }

  return errors;
}
