# Operations Pack

Monitoring requirements, runbooks, and audit readiness for StelloFi as deployed on Stellar mainnet
on 2026-08-31. Written against the system as deployed, not against an intended design.

## Monitoring requirements

One check runs today: the risk engine compares vault holdings against obligations every five minutes
and pauses on a shortfall. Everything else below is a **requirement, not a deployed alert** — stated
so the gap is visible rather than assumed closed.

| Signal | Threshold | Why it matters | Status |
|---|---|---|---|
| Solvency | assets < obligations | The vault promising XLM it does not hold. Auto-pauses. | **live** |
| Exchange rate | any fall | The rate can only fall on a loss. With no strategies deployed there is no legitimate cause, so any drop is a defect. | required |
| Contract TTL | < 7 days | Archived contracts are uncallable until restored. Bumping depends on one backend. | required |
| Keeper liveness | no run in 12h | Silent keeper failure is invisible; the first symptom is an archived contract weeks later. | required |
| Reserve utilisation | > 85% | Approaching the 90% cap means borrowing stops and suppliers cannot exit. | required |
| Admin key activity | any non-keeper call | The key can upgrade every contract. An unexpected signature is the earliest signal of compromise. | required |
| Pending withdrawals | stale > 30 days | Unclaimed exits hold assets against burned shares. Three sat unclaimed for five months. | required |

## Keeper runbook

The keeper signs with the admin key and runs three loops: TTL bumps every 24 hours, a harvest cycle
every 6 hours, and a solvency check every 5 minutes. It cannot move user funds — it calls fixed
entrypoints only.

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

The risk engine pauses automatically. **Do not unpause to restore service.** Establish first whether
assets genuinely fell or a number is wrong — with assets derived from balances, a shortfall means the
contract is really short, not that a counter drifted.

Read `idle_balance`, `pending_withdrawals`, `treasury_balance` and the sXLM supply. Reconstruct what
is owed by hand. If holdings genuinely fall short, the deficit is real and must be funded before
reopening; a contribution via `add_rewards` raises the rate for everyone and closes it.

### Admin key compromise

**There is no recovery path today.** One signature can upgrade all five contracts. If it is
compromised, an attacker replaces the code and everything else is irrelevant. Pause immediately if
you still can, then `set_admin` to a safe account on all five — you are racing whoever else holds the
key.

This is why moving to a multisig is the highest-value outstanding change. It converts an
unrecoverable event into a survivable one.

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
| **Key custody** | **single key** | **Blocker.** An auditor will open here. Multisig converts it from a finding to a control. |
| External audit | none | Protocol is live and unaudited; documentation states this plainly |
| Withdrawal queue scale | known limit | One entry holds all requests; fails in the hundreds. Unreachable while nothing is deployed externally. |

**Two items block a clean audit conversation, and both are cheap.** Source verification is an hour and
free. Multisig is an afternoon. Neither requires new contract code, and together they move the largest
open finding from unresolved to controlled.
