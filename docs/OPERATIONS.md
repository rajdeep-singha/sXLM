# Operations Pack

Monitoring requirements, runbooks, and audit readiness for StelloFi as deployed on Stellar mainnet
on 2026-08-31. Written against the system as deployed, not against an intended design.

## Monitoring requirements

One check runs today: the risk engine compares vault holdings against obligations every five minutes
and alerts on a shortfall. Everything else below is a **requirement, not a deployed alert** — stated
so the gap is visible rather than assumed closed.

| Signal | Threshold | Why it matters | Status |
|---|---|---|---|
| Solvency | assets < obligations | The vault promising XLM it does not hold. Alerts the signers, who pause. | **live** |
| Exchange rate | any fall | The rate can only fall on a loss. With no strategies deployed there is no legitimate cause, so any drop is a defect. | required |
| Contract TTL | < 7 days | Archived contracts are uncallable until restored. Bumping depends on one backend. | required |
| Keeper liveness | no run in 12h | Silent keeper failure is invisible; the first symptom is an archived contract weeks later. | required |
| Reserve utilisation | > 85% | Approaching the 90% cap means borrowing stops and suppliers cannot exit. | required |
| Admin key activity | any transaction from the admin account | The admin can upgrade every contract. The keeper no longer signs as admin, so every admin transaction should match a planned signing session. | required |
| Pending withdrawals | stale > 30 days | Unclaimed exits hold assets against burned shares. Three sat unclaimed for five months. | required |

## Keeper runbook

The keeper signs with its own key (`KEEPER_SECRET_KEY`), never the admin's, and only calls
permissionless entrypoints: `bump_instance` on all five contracts every 24 hours, and
`collect_protocol_fees` and `settle_interest` every 6 hours. The risk engine runs a solvency check
every 5 minutes. Neither can move user funds or change parameters. The backend refuses to start the
keeper with the admin key, and `tests/keeper.test.ts` checks every keeper method against the
contract source for `require_auth`.

**Confirm it is alive.** Contract TTLs rising is the only proof that matters; logs can lie about work
that failed silently.

```bash
stellar contract invoke --id $VAULT --network mainnet \
  --source-account $ADMIN --send=no -- total_assets
```

**Down under 7 days.** No urgency. TTL is bumped to roughly 30 days on each run, so a week of
downtime consumes buffer without risk. Restart and confirm the next bump lands.

**Down beyond 20 days.** Bump manually from any funded account — `bump_instance` is permissionless by
design, so the admin key is not required.

```bash
for C in $VAULT $TOKEN $LENDING $POOL $GOV; do
  stellar contract invoke --id $C --source any-funded-key \
    --network mainnet -- bump_instance
done
```

**Settling interest.** `settle_interest` on the lending contract moves accrued interest to the vault,
80% to holders. Permissionless — it only moves money to two fixed destinations, so anyone may call it
and nobody gains by doing so.

## Incident runbook

### Solvency shortfall

The risk engine alerts through the configured webhooks; it does not pause or unpause. Two signers
pause the vault (see *Signing an admin call* below). **Do not unpause to restore service.** Establish first whether
assets genuinely fell or a number is wrong — with assets derived from balances, a shortfall means the
contract is really short, not that a counter drifted.

Read `idle_balance`, `pending_withdrawals`, `treasury_balance` and the sXLM supply. Reconstruct what
is owed by hand. If holdings genuinely fall short, the deficit is real and must be funded before
reopening; a contribution via `add_rewards` raises the rate for everyone and closes it.

### Admin key compromise

**Before the multisig conversion there is no recovery path.** One signature can upgrade all five
contracts. Only the vault and the token have `set_admin`; lending, LP pool and governance can change
admin only by upgrade. The fastest response is to convert the admin account in place (next section),
which takes the leaked key's weight to 0 on all five contracts in one transaction — you are racing
whoever else holds the key.

**After the conversion,** one leaked signer key cannot act alone. Two remaining signers remove it
with `set_options` (signer weight 0) and add a replacement. Nothing changes on the contracts.

## Admin multisig

The admin account `GDWXTIIR…VZ5N` is converted to a multisig in place. Contracts check the admin
with `require_auth`, which a classic account satisfies through its own signers and thresholds, so
no contract changes and no admin address changes.

Plan: three signers of weight 1, threshold 2 for low, medium and high, master key weight 0.
`backend/multisig-plan.example.json` shows the format.

### Conversion

Rehearse every step on testnet against a replica admin account before mainnet.

1. Move the keeper to its own funded account and set `KEEPER_SECRET_KEY`. Confirm one TTL bump lands
   from the keeper's address.
2. Validate the plan. It refuses any plan where the signers cannot reach the threshold, where losing
   one key would lock the account, or where one signer could act alone.
   ```bash
   cd backend
   npm run multisig -- check plan.json
   ```
3. Build the unsigned transaction: one `set_options` per signer, then one that sets the thresholds
   and the master weight to 0. Valid for one hour.
   ```bash
   npm run multisig -- build plan.json
   ```
4. Sign the XDR with the current admin key, offline, and submit it.
   ```bash
   stellar tx sign --sign-with-key current-admin --network mainnet < convert.xdr > convert.signed.xdr
   stellar tx send --network mainnet < convert.signed.xdr
   ```
5. Verify the account on chain matches the plan.
   ```bash
   npm run multisig -- verify plan.json
   ```
6. Prove the signing path with a no-op admin call: `upgrade` each contract to its current WASM hash
   (see the deployment register), signed by two signers.
7. Remove `ADMIN_SECRET_KEY` from every environment and record the signers in the deployment
   register.

### Signing an admin call

Build the call with the admin as source account, simulate it, collect two signatures, submit.

```bash
stellar contract invoke --id $VAULT --network mainnet \
  --source-account $ADMIN_PUBLIC_KEY --build-only -- pause > pause.xdr
stellar tx simulate --network mainnet < pause.xdr > pause.sim.xdr
stellar tx sign --sign-with-key signer-a --network mainnet < pause.sim.xdr > pause.a.xdr
stellar tx sign --sign-with-key signer-b --network mainnet < pause.a.xdr > pause.ab.xdr
stellar tx send --network mainnet < pause.ab.xdr
```

The admin authorises as the transaction source, so the envelope signatures satisfy `require_auth`
once their weight meets the account's threshold. The testnet rehearsal confirms this for `pause`,
`unpause`, `upgrade` and `set_governance` before mainnet.

### RPC or backend outage

The contracts are unaffected — they do not depend on this infrastructure to hold funds or honour
withdrawals. Users can transact directly against the contracts with any Soroban client. The
consequence of a long outage is TTL, covered above, not loss.

### Stuck withdrawal

A queued withdrawal claims only after its cooldown ledger. If a user reports failure, read
`get_withdrawal` and compare `unlock_ledger` against the current ledger. Three mainnet withdrawals
appeared stuck for five months for exactly this reason — the claims were attempted before cooldown,
then never retried. Only the holder can sign the claim.

## Audit readiness

| Item | State | Note |
|---|---|---|
| Unit + integration tests | 86 passing | Across five contracts, including invariant and attack-path tests |
| Invariant coverage | present | No user action moves the rate; rounding never favours the actor; dead shares unredeemable |
| Upgrade path | rehearsed | Executed against a testnet replica of live state before mainnet |
| Reentrancy | guarded | Flash loans block deposits, withdrawals and claims for their duration |
| Storage migration | proven | Keys shown name-addressed by test, so removed variants orphan safely |
| **Source verification** | **not done** | **Blocker.** Deployed bytecode cannot be matched to this repository. Free; one hour. |
| **Key custody** | **single key** | **Blocker.** Conversion tooling and runbook are ready (*Admin multisig*); the mainnet conversion has not run. |
| External audit | none | Protocol is live and unaudited; documentation states this plainly |
| Withdrawal queue scale | known limit | One entry holds all requests; fails in the hundreds. Unreachable while nothing is deployed externally. |

**Two items block a clean audit conversation, and both are cheap.** Source verification is an hour and
free. Multisig is an afternoon. Neither requires new contract code, and together they move the largest
open finding from unresolved to controlled.
