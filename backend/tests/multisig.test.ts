import { describe, it, expect } from "vitest";
import { Account, Keypair, Networks, xdr } from "@stellar/stellar-sdk";
import {
  buildConversionTransaction,
  checkAccountMatchesPlan,
  validateMultisigPlan,
  type MultisigPlan,
} from "../src/multisig/plan.js";

const admin = Keypair.random().publicKey();
const [a, b, c] = [0, 1, 2].map(() => Keypair.random().publicKey()) as [string, string, string];
const keeper = Keypair.random().publicKey();

function twoOfThree(overrides: Partial<MultisigPlan> = {}): MultisigPlan {
  return {
    adminPublicKey: admin,
    signers: [
      { publicKey: a, weight: 1 },
      { publicKey: b, weight: 1 },
      { publicKey: c, weight: 1 },
    ],
    threshold: 2,
    keeperPublicKey: keeper,
    ...overrides,
  };
}

describe("Multisig plan validation", () => {
  it("accepts 2-of-3", () => {
    expect(validateMultisigPlan(twoOfThree())).toEqual([]);
  });

  it("refuses a threshold the signers cannot reach", () => {
    const errors = validateMultisigPlan(twoOfThree({ threshold: 4 }));
    expect(errors.join()).toMatch(/would be locked/);
  });

  it("refuses a plan that one lost key would lock", () => {
    const errors = validateMultisigPlan(twoOfThree({ threshold: 3 }));
    expect(errors.join()).toMatch(/losing the heaviest signer/);
  });

  it("refuses a signer who can act alone", () => {
    const errors = validateMultisigPlan(
      twoOfThree({
        signers: [
          { publicKey: a, weight: 2 },
          { publicKey: b, weight: 1 },
          { publicKey: c, weight: 1 },
        ],
      })
    );
    expect(errors.join()).toMatch(/act alone/);
  });

  it("refuses a threshold of 1", () => {
    expect(validateMultisigPlan(twoOfThree({ threshold: 1 })).join()).toMatch(/threshold/);
  });

  it("refuses fewer than two signers", () => {
    const errors = validateMultisigPlan(twoOfThree({ signers: [{ publicKey: a, weight: 1 }] }));
    expect(errors.join()).toMatch(/at least 2 signers/);
  });

  it("refuses the keeper, the admin, or a duplicate as a signer", () => {
    const withKeeper = twoOfThree({
      signers: [
        { publicKey: a, weight: 1 },
        { publicKey: b, weight: 1 },
        { publicKey: keeper, weight: 1 },
      ],
    });
    expect(validateMultisigPlan(withKeeper).join()).toMatch(/keeper/);

    const withAdmin = twoOfThree({
      signers: [
        { publicKey: a, weight: 1 },
        { publicKey: b, weight: 1 },
        { publicKey: admin, weight: 1 },
      ],
    });
    expect(validateMultisigPlan(withAdmin).join()).toMatch(/admin's own key/);

    const duplicate = twoOfThree({
      signers: [
        { publicKey: a, weight: 1 },
        { publicKey: a, weight: 1 },
        { publicKey: b, weight: 1 },
      ],
    });
    expect(validateMultisigPlan(duplicate).join()).toMatch(/listed twice/);
  });

  it("refuses malformed addresses", () => {
    const errors = validateMultisigPlan(
      twoOfThree({
        signers: [
          { publicKey: "G...SIGNER_A", weight: 1 },
          { publicKey: b, weight: 1 },
          { publicKey: c, weight: 1 },
        ],
      })
    );
    expect(errors.join()).toMatch(/not a valid account address/);
  });
});

describe("Conversion transaction", () => {
  const source = () => new Account(admin, "100");

  it("adds every signer, then zeroes the master key and sets thresholds last", () => {
    const tx = buildConversionTransaction(source(), twoOfThree(), Networks.TESTNET);
    expect(tx.source).toBe(admin);
    expect(tx.operations).toHaveLength(4);

    const added = tx.operations.slice(0, 3).map((op) => {
      expect(op.type).toBe("setOptions");
      const signer = (op as { signer?: { ed25519PublicKey?: string; weight?: number } }).signer;
      return [signer?.ed25519PublicKey, signer?.weight];
    });
    expect(added).toEqual([[a, 1], [b, 1], [c, 1]]);

    const last = tx.operations[3] as {
      type: string;
      masterWeight?: number;
      lowThreshold?: number;
      medThreshold?: number;
      highThreshold?: number;
    };
    expect(last.type).toBe("setOptions");
    expect(last.masterWeight).toBe(0);
    expect([last.lowThreshold, last.medThreshold, last.highThreshold]).toEqual([2, 2, 2]);
  });

  it("round-trips through XDR", () => {
    const tx = buildConversionTransaction(source(), twoOfThree(), Networks.TESTNET);
    expect(() => xdr.TransactionEnvelope.fromXDR(tx.toXDR(), "base64")).not.toThrow();
  });

  it("refuses to build an invalid plan", () => {
    expect(() =>
      buildConversionTransaction(source(), twoOfThree({ threshold: 4 }), Networks.TESTNET)
    ).toThrow(/refusing/);
  });

  it("refuses a source account that is not the admin", () => {
    const other = new Account(Keypair.random().publicKey(), "1");
    expect(() => buildConversionTransaction(other, twoOfThree(), Networks.TESTNET)).toThrow(
      /does not match/
    );
  });
});

describe("On-chain verification", () => {
  const converted = {
    thresholds: { low_threshold: 2, med_threshold: 2, high_threshold: 2 },
    signers: [
      { key: a, weight: 1, type: "ed25519_public_key" },
      { key: b, weight: 1, type: "ed25519_public_key" },
      { key: c, weight: 1, type: "ed25519_public_key" },
      { key: admin, weight: 0, type: "ed25519_public_key" },
    ],
  };

  it("passes when the account matches the plan", () => {
    expect(checkAccountMatchesPlan(converted, twoOfThree())).toEqual([]);
  });

  it("flags an account that was never converted", () => {
    const untouched = {
      thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
      signers: [{ key: admin, weight: 1, type: "ed25519_public_key" }],
    };
    const errors = checkAccountMatchesPlan(untouched, twoOfThree()).join("\n");
    expect(errors).toMatch(/master key weight is 1/);
    expect(errors).toMatch(/signer missing/);
    expect(errors).toMatch(/medium threshold is 0/);
  });

  it("flags an unexpected signer", () => {
    const extra = Keypair.random().publicKey();
    const state = {
      ...converted,
      signers: [...converted.signers, { key: extra, weight: 1, type: "ed25519_public_key" }],
    };
    expect(checkAccountMatchesPlan(state, twoOfThree()).join()).toMatch(/unexpected signer/);
  });
});
