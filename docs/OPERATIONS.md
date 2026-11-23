# Operations Pack

Monitoring, runbooks and audit readiness for StelloFi on Stellar mainnet. Written against the code in
this repository and the chain as read on 2026-11-23. Where code is ready but not yet deployed, the
table says so.

## Monitoring

The monitor (`backend/src/monitor/`) runs every 5 minutes when `RUN_AUTOMATION=true`. It reads the
chain, applies the rules below and posts to Slack (`SLACK_WEBHOOK_URL`) and a JSON webhook
(`ALERT_WEBHOOK_URL`). It signs nothing. A check that cannot read its data raises `check_failed`
rather than going quiet.

| Alert | Fires when | Why it matters |
|---|---|---|
| `solvency` | vault holds less than share claims + queued withdrawals + fees | The vault promising XLM it does not hold. Signers pause. |
| `rate_fall` | exchange rate below the previous reading | The rate falls only on a loss. With no strategies deployed there is no legitimate cause. |
| `ttl_low` | a contract instance or its code has under 7 days of TTL (critical under 1) | Archived contracts are uncallable until restored. |
| `keeper_silent` | no keeper transaction for 12 hours, or keeper balance under 2 XLM | A silent keeper shows up weeks later as an archived contract. |
| `utilisation_high` | lending reserve over 85% lent (critical from 90%) | At the 90% cap borrowing stops and suppliers cannot exit. |
| `admin_activity` | any operation signed by the admin account | The admin can upgrade every contract. Each one should match a planned signing session. |
| `withdrawal_stale` | a queued withdrawal unclaimed 30 days after unlock | Unclaimed exits hold assets against burned shares. |

Each alert is sent when it starts, repeated every 24 hours while it lasts, and sent again when it
clears. Thresholds can be tightened with `ALERT_*` variables (see `backend/.env.example`).

```bash
cd backend
npm run alerts -- check              # every rule once against the chain; sends nothing
npm run alerts -- test-fire all      # one [TEST] message per rule to every destination
```

`/health` on the backend reports keeper liveness, active alerts and the state of every RPC and Horizon
endpoint.

**First run against mainnet (2026-11-23), before deployment:** five findings, all real. Three
withdrawals unclaimed 221–226 days after unlock; lending reserve 88.68% utilised; keeper has never
sent a transaction.

## RPC and Horizon failover

Every backend call goes through `backend/src/stellar/network.ts`. Endpoints are tried in order; one
that is unreachable, times out, or answers 5xx/429 is skipped for 60 seconds. An answer from a
reachable endpoint, including an error, is returned as is. Resubmitting a signed transaction to a
second provider is safe: the network applies a hash once.

| Setting | Default on mainnet |
|---|---|
| `STELLAR_RPC_URLS` | `mainnet.sorobanrpc.com`, `soroban-rpc.mainnet.stellar.gateway.fm`, `rpc.lightsail.network` |
| `STELLAR_HORIZON_URLS` | `horizon.stellar.org`, `horizon.stellar.lobstr.co` |

A paid provider goes first in `STELLAR_RPC_URLS` once contracted. The frontend reads balances and
the cooldown through the same pattern (`VITE_SOROBAN_RPC_URLS`, `VITE_HORIZON_URLS`).
`backend/tests/network.test.ts` forces a refused connection, a 503 and a dropped connection in front
of a working endpoint and checks the call completes.

During development `mainnet.sorobanrpc.com` refused connections intermittently on 2026-11-23; calls
completed on the next provider.

## Keeper runbook

The keeper signs with its own key (`KEEPER_SECRET_KEY`), never the admin's, and only calls
permissionless entrypoints: `bump_instance` on all five contracts every 24 hours, and
`collect_protocol_fees` and `settle_interest` every 6 hours. It cannot move user funds or change
parameters. The backend refuses to start the keeper with the admin key, and
`backend/tests/keeper.test.ts` checks every keeper method against the contract source for
`require_auth`.

**Confirm it is alive.** `/health` shows `keeper.lastTtlBumpAt`; the `keeper_silent` alert fires
after 12 hours without a keeper transaction. On chain:

```bash
curl -s "https://horizon.stellar.org/accounts/$KEEPER/transactions?order=desc&limit=5"
```

**Down under 7 days.** No urgency. TTL is bumped to about 30 days each run. Restart and confirm the
next bump lands.

**Down beyond 20 days.** Bump manually from any funded account; `bump_instance` is permissionless.

```bash
for C in $VAULT $TOKEN $LENDING $POOL $GOV; do
  stellar contract invoke --id $C --source any-funded-key --network mainnet -- bump_instance
done
```

## Incident runbook

### Solvency shortfall

The monitor alerts; it does not pause or unpause. Two signers pause the vault (*Signing an admin
call*). **Do not unpause to restore service.** Establish first whether assets genuinely fell or a
number is wrong. With assets derived from balances, a shortfall means the contract is really short.

Read `idle_balance`, `pending_withdrawals`, `treasury_balance` and the sXLM supply. If holdings
genuinely fall short, fund the deficit before reopening; `add_rewards` raises the rate for everyone
and closes it.

### Admin key compromise

**Before the multisig conversion there is no recovery path.** One signature can upgrade all five
contracts. Convert the admin account in place (next section): one transaction takes the leaked key's
weight to 0 on all five contracts. You are racing whoever else holds the key.

**After the conversion,** one leaked signer key cannot act alone. Two remaining signers remove it and
add a replacement in one transaction:

```bash
stellar tx new set-options --network mainnet --inclusion-fee 1000 --source-account $ADMIN_PUBLIC_KEY \
  --build-only --signer $COMPROMISED --signer-weight 0 > rotate.xdr
stellar tx op add set-options --source-account $ADMIN_PUBLIC_KEY \
  --signer $REPLACEMENT --signer-weight 1 < rotate.xdr > rotate2.xdr
stellar tx sign --sign-with-key signer-b --network mainnet < rotate2.xdr > rotate.b.xdr
stellar tx sign --sign-with-key signer-c --network mainnet < rotate.b.xdr > rotate.bc.xdr
stellar tx send --network mainnet < rotate.bc.xdr
cd backend && npm run multisig -- verify plan-after-rotation.json
```

The explicit fee matters: the transaction carries two operations and the default fee covers one, so
without it the network rejects it with `TxInsufficientFee`. Nothing changes on the contracts. The
testnet drill took 3 seconds from building the transaction to the rotation landing
(`docs/evidence/testnet-rehearsal.md`, section 8).

### RPC or backend outage

The contracts do not depend on this infrastructure to hold funds or honour withdrawals; users can
transact against them with any Soroban client. The backend fails over between providers on its own.
The consequence of a long backend outage is TTL, covered above, not loss.

### Stuck withdrawal

A queued withdrawal claims only after its unlock ledger. Read `get_user_withdrawals` (version 3) or
`get_withdrawal` and compare `unlock_ledger` with the current ledger. Only the holder can sign the
claim; the backend cannot claim for anyone.

## Admin multisig

The admin account `GDWXTIIR…VZ5N` is converted to a multisig in place. Contracts check the admin with
`require_auth`, which a classic account satisfies through its own signers and thresholds, so no
contract and no admin address changes.

Plan: three signers of weight 1, threshold 2 for low, medium and high, master key weight 0.
`backend/multisig-plan.example.json` shows the format.

### Conversion

Rehearsed on testnet: `docs/evidence/testnet-rehearsal.md`, section 2.

1. Move the keeper to its own funded account and set `KEEPER_SECRET_KEY`. Confirm one TTL bump lands
   from the keeper's address.
2. Validate the plan. It refuses any plan where the signers cannot reach the threshold, where losing
   one key would lock the account, or where one signer could act alone.
   ```bash
   cd backend
   npm run multisig -- check plan.json
   ```
3. Build the unsigned transaction: one `set_options` per signer, then one that sets the thresholds and
   the master weight to 0. Valid for one hour.
   ```bash
   npm run multisig -- build plan.json | tail -1 > convert.xdr
   ```
4. Sign with the current admin key and submit.
   ```bash
   stellar tx sign --sign-with-key current-admin --network mainnet < convert.xdr > convert.signed.xdr
   stellar tx send --network mainnet < convert.signed.xdr
   ```
5. Verify the account on chain matches the plan.
   ```bash
   npm run multisig -- verify plan.json
   ```
6. Remove `ADMIN_SECRET_KEY` from every environment and record the signers in the deployment
   register.

### Signing an admin call

Build the call with the admin as source account, simulate it, collect two signatures, submit.

```bash
stellar contract invoke --id $VAULT --network mainnet \
  --source-account $ADMIN_PUBLIC_KEY --build-only -- pause > pause.xdr
stellar tx simulate --network mainnet --source-account $ADMIN_PUBLIC_KEY < pause.xdr > pause.sim.xdr
stellar tx sign --sign-with-key signer-a --network mainnet < pause.sim.xdr > pause.a.xdr
stellar tx sign --sign-with-key signer-b --network mainnet < pause.a.xdr > pause.ab.xdr
stellar tx send --network mainnet < pause.ab.xdr
```

The admin authorises as the transaction source, so the envelope signatures satisfy `require_auth`
once their weight meets the threshold. The testnet rehearsal ran exactly these commands for
`upgrade`, `pause`, `unpause` and `set_governance`, and showed one signature is refused.

## Contract version 3 and verified upgrades

Version 3 changes, all covered by tests in `contracts/`:

| Change | Contracts |
|---|---|
| Withdrawal requests stored one per entry, indexed per account, deleted on claim; legacy map drained by `migrate_withdrawals` | vault |
| Every parameter setter answers to governance once `set_governance` is called (the `update_*` setters, `set_cooldown_period`, `set_protocol_fee_bps` no longer bypass it) | lending, vault, LP pool |
| LP pool gains `set_governance` and `set_param` (`swap_fee`, `proto_fee`, `vlt_share`) | LP pool |
| `set_admin`, requiring both the current and the new admin | lending, LP pool, governance (added); vault, token (now two-party) |
| LP protocol fee reads its default (5 bps) when unset; mainnet has had no entry, so fees were off | LP pool |
| Protocol cut can never exceed the swap fee paid | LP pool |
| Borrow-rate changes accrue at the old rate first; liquidation keeps the borrowed total exact | lending |
| `withdraw_fees` pays the treasury address, not always the admin | vault |
| `version()` returns 3 | all five |

### Building verifiable WASM

Pushing a tag `contracts-v*` runs `.github/workflows/release-contracts.yml`, which builds each
contract with `stellar-expert/soroban-build-workflow`, publishes a GitHub release with the WASM and
its SHA-256, and attaches a build attestation. A contract uploaded from that exact file shows as
verified source on stellar.expert. **Never upgrade mainnet from a local build**: it hashes
differently and cannot be verified.

The cutover procedure is in `docs/MAINNET_CUTOVER.md`.

## Audit readiness

| Item | State | Note |
|---|---|---|
| Contract tests | 122 passing | Unit, attack-path and property tests across five contracts |
| Property tests | present | Rate never falls; rate never rises without inflow; deposit/withdraw symmetry; queue liability equals open requests; claims pay exactly once; debts add up across random borrow/repay/liquidate/rate-change sequences |
| Backend tests | 66 passing | Multisig plan rules, keeper permissions, alert rules, failover against live HTTP endpoints |
| Upgrade path | rehearsed | Mainnet WASM deployed on testnet, upgraded to version 3 through the multisig, state compared before and after (`docs/evidence/testnet-rehearsal.md`) |
| Storage migration | proven | Every contract reads the exact mainnet storage of 2026-11-23 correctly with no migration call (tests named `reads_the_live_mainnet_storage_unchanged`) |
| Reentrancy | guarded | Flash loans block deposits, withdrawals and claims for their duration |
| **Source verification** | **ready, not run** | Release workflow in place; verified once the version-3 release is uploaded and the contracts upgraded to it |
| **Key custody** | **ready, not run** | Conversion tooling, rehearsal and runbook complete; mainnet conversion needs the three signers |
| Withdrawal queue scale | fixed in version 3 | A claim's cost stays flat with 400 requests queued (test); live once upgraded |
| External audit | none | Protocol is live and unaudited |
