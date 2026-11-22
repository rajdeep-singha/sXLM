import { Keypair } from "@stellar/stellar-sdk";

/**
 * Load the keeper keypair and refuse any key that would put admin power back
 * on this server.
 *
 * The keeper only calls permissionless entrypoints, so it never needs the
 * admin key. Running it with the admin key would either fail once the admin
 * is a multisig, or, before that, keep a single admin signature on a server.
 */
export function loadKeeperKeypair(secret: string, adminPublicKey: string): Keypair {
  if (!secret) {
    throw new Error("KEEPER_SECRET_KEY is not set");
  }

  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(secret);
  } catch {
    throw new Error("KEEPER_SECRET_KEY is not a valid Stellar secret key");
  }

  if (keypair.publicKey() === adminPublicKey) {
    throw new Error(
      "KEEPER_SECRET_KEY is the admin key. The keeper must run on its own account."
    );
  }

  return keypair;
}
