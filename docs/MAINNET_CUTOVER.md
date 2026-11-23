# Mainnet Cutover: Multisig, Version 3, Governance

The order is fixed: each phase depends on the one before. Every command builds, signs or checks
something; nothing here signs with a key that is not yours to hold. Rehearsed end to end on testnet
(`docs/evidence/testnet-rehearsal.md`).

```bash
export VAULT=CDYXKWVDGEVA6OSIGN7GRAPPRN6AKID35OJL5ZZQIBCMECZ35KGL45PS
export TOKEN=CCGFHMW3NZD5Z7ATHYHZSEG6ABCJADUHP5HIAWFPR37CP4VGNEDQO7FJ
export LENDING=CAOWXZ6BWA2ZYY7GHD75OFKADKUJS4WCKPDYGGXULQWFJRB55TXAQNJG
export LP=CAW2DRMOI3CCJWKVMEUWYJUEQHXB4S4DR72HNL2DWQCMQQUH3LFFVLHV
export GOV=CB7LV3FBQ7US26GVC7SM7RMX22IEEHAEUL7V3TDDWM32DHA5TDFDDEP4
export ADMIN=GDWXTIIROGCVBSNQMBJFH6HOWQ4YSRVMKSUS53CH6MP56WSWD6J4VZ5N
```

## 0. Before starting

- [ ] Backend from this repository deployed, `RUN_AUTOMATION=true`, `KEEPER_SECRET_KEY` set.
- [ ] `/health` shows `keeper.running: true` and a recent `keeper.lastTtlBumpAt`.
- [ ] `SLACK_WEBHOOK_URL` or `ALERT_WEBHOOK_URL` set; `npm run alerts -- test-fire all` delivered.
- [ ] Three signers chosen; each has sent a public key (G…) from a hardware wallet.
- [ ] An account with about 30 XLM to pay for uploading five WASMs (not the admin, not the keeper).

## 1. Build verifiable WASM

```bash
git tag contracts-v0.3.0
git push origin contracts-v0.3.0
gh run watch                                  # release-contracts.yml, five jobs
gh release download contracts-v0.3.0 -D release/
shasum -a 256 release/*.wasm                  # must equal the hashes printed in the workflow log
```

## 2. Rehearse with the release binaries

The earlier rehearsal used local builds. Run it again with the exact files mainnet will get.

```bash
mkdir -p mainnet-wasm
for p in "vault $VAULT" "token $TOKEN" "lending $LENDING" "lp $LP" "gov $GOV"; do
  set -- $p; stellar contract fetch --id $2 --network mainnet -o mainnet-wasm/$1.wasm
done
scripts/rehearsal/testnet-rehearsal.sh mainnet-wasm release docs/evidence/testnet-rehearsal-release.md
```

Every check must pass before continuing.

## 3. Convert the admin account to 2-of-3

Write `plan.json` with the three signer keys and the keeper address (format:
`backend/multisig-plan.example.json`).

```bash
cd backend
npm run multisig -- check plan.json
npm run multisig -- build plan.json | tail -1 > convert.xdr
stellar tx sign --sign-with-key mainnet-admin --network mainnet < convert.xdr > convert.signed.xdr
stellar tx send --network mainnet < convert.signed.xdr
npm run multisig -- verify plan.json          # must print "Account matches the plan."
cd ..
```

From here every admin action needs two signers, and the `admin_activity` alert reports each one.

## 4. Upload and upgrade the five contracts

Upload from the funded account (uploading is not an admin action):

```bash
for w in release/*.wasm; do
  echo "$w $(stellar contract upload --network mainnet --source-account uploader --wasm $w)"
done
```

Then, for each contract, with its uploaded hash `$HASH`:

```bash
multisig() {  # multisig <contract> <fn> [args...]
  local id=$1; shift
  stellar contract invoke --id $id --network mainnet --source-account $ADMIN --build-only -- "$@" > call.xdr
  stellar tx simulate --network mainnet --source-account $ADMIN < call.xdr > call.sim.xdr
  stellar tx sign --sign-with-key signer-a --network mainnet < call.sim.xdr > call.a.xdr
  stellar tx sign --sign-with-key signer-b --network mainnet < call.a.xdr > call.ab.xdr
  stellar tx send --network mainnet < call.ab.xdr
  stellar tx hash --network mainnet < call.ab.xdr
}

multisig $TOKEN   upgrade --new_wasm_hash $TOKEN_HASH
multisig $VAULT   upgrade --new_wasm_hash $VAULT_HASH
multisig $LENDING upgrade --new_wasm_hash $LENDING_HASH
multisig $LP      upgrade --new_wasm_hash $LP_HASH
multisig $GOV     upgrade --new_wasm_hash $GOV_HASH
```

Each signer signs on their own device; the files move between them. Check:

```bash
for c in $TOKEN $VAULT $LENDING $LP $GOV; do
  stellar contract invoke --id $c --network mainnet --source-account $ADMIN --send=no -- version   # 3
done
stellar contract invoke --id $LP --network mainnet --source-account $ADMIN --send=no -- protocol_fee_bps   # 5
```

Compare `get_exchange_rate`, `total_supply`, `get_reserves` and `total_borrowed` with readings taken
just before the upgrade. They must match (interest accrues by the second; allow for it).

## 5. Move the legacy withdrawal queue

Anyone may call this; it moves the five legacy entries (three open) into per-request storage.

```bash
stellar contract invoke --id $VAULT --network mainnet --source-account uploader -- migrate_withdrawals --limit 10
stellar contract invoke --id $VAULT --network mainnet --source-account uploader --send=no -- legacy_queue_len   # 0
```

## 6. Hand parameters to governance

```bash
multisig $VAULT   set_governance --governance $GOV
multisig $TOKEN   set_governance --governance $GOV
multisig $LENDING set_governance --governance $GOV
multisig $LP      set_governance --governance $GOV
```

Each can be called once. Afterwards a parameter changes only through a passed proposal and its
timelock; the admin keeps upgrade, pause and fee withdrawal. Note that the token's minter becomes
fixed: governance proposals carry numbers, not addresses, so `set_minter` cannot be reached.

## 7. Evidence and records

- [ ] stellar.expert shows verified source for all five contracts.
- [ ] Record the conversion hash, five upgrade hashes, the migration hash and four `set_governance`
      hashes in `docs/DEPLOYMENT_REGISTER.md`, with the signers and the new WASM hashes.
- [ ] Remove `ADMIN_SECRET_KEY` from every environment.
- [ ] `npm run alerts -- check` shows no `ttl_low`, `keeper_silent` or `check_failed`.
