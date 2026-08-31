# Accounting and Permission Review

Review of sXLM share accounting, vault exchange-rate logic, deposits, redemptions, fee handling,
keeper permissions, pause controls and oracle boundaries. Conducted August 2026 against the code
running on Stellar mainnet; all findings fixed and deployed on 2026-08-31.

## Summary

| | Before | After |
|---|---|---|
| Contract tests | 6 | 86 |
| Exchange rate | 2.0869891 (overstated 5.69%) | 2.0320044 |
| Paths that could raise the rate without assets | 1 | 0 |
| Admin-settable prices | 1 | 0 |
| Yield reaching sXLM holders | 0 sources | 5 sources |

## Findings

### 1. The rate could rise with no assets behind it — critical

`add_rewards()` incremented a stored asset counter and credited a treasury balance without
transferring any XLM. `withdraw_fees()` then paid real XLM to the admin against that balance.

The keeper called `add_rewards` on a 6-hour cron. It never fired in practice only because the
function feeding it returned zero — see finding 6.

**Fixed.** The stored counter was deleted. `total_assets()` is derived on every read as
`idle balance + deployed − pending withdrawals − treasury`. `add_rewards` transfers XLM in before
crediting anything. A stored numerator that can drift from real holdings is the bug class; deriving
it removes the class rather than one instance.

### 2. Queued withdrawals inflated the rate — live on mainnet

When a withdrawal was queued, shares were burned but the XLM owed was never recorded. Denominator
fell, numerator did not, and the rate rose for remaining holders by money already spoken for.

This was live: the mainnet rate read **5.69% higher** than the vault could pay.

**Fixed.** The liability is recorded in the same call that burns the shares and retired when the
claim pays. `migrate_v2()` reconstructed the existing liability from the queue — 38,114,885 stroops,
matching prediction exactly.

### 3. First-depositor share price manipulation

No dead shares existed. The first depositor could set the share price by donating to an empty vault.

**Fixed.** 1,000 shares are minted to the contract on the first deposit and can never be redeemed.

### 4. Admin set the price used to value collateral

`lending::update_exchange_rate(rate)` was an admin setter. Setting it high allowed borrowing against
inflated collateral; setting it low allowed mass liquidation. It also contradicted the published
documentation, which stated the rate was not oracle-set.

**Fixed.** Lending reads `get_exchange_rate()` from the vault cross-contract. The setter is deleted.
`set_vault` is one-shot, so the source cannot be re-pointed later.

### 5. Admin could mint unlimited sXLM

`set_minter` was admin-only with no constraint. The admin could point the minter at themselves and
dilute every holder.

**Fixed.** Governance-gated, using the same pattern as other parameters.

### 6. Borrowers paid no interest

`BorrowRateBps` was stored, settable and governance-controllable — and used in exactly one place: the
getter that returned it. `repay()` returned the principal and nothing more.

**Fixed.** Index-based accrual; debt grows with time. 80% of interest is transferred to the vault and
raises the rate for all holders; the remainder is protocol revenue.

### 7. Governance was decorative

Passed proposals wrote a value into governance's own storage that no contract read. Quorum was
skipped entirely — the check was guarded by a reference supply that `initialize` set to zero. Vote
weight was a live `balance()` call, so the same tokens could vote and be sold in one ledger.

**Fixed.** `execute_proposal` calls the target contract directly. Quorum is mandatory, measured
against a supply snapshot taken at creation. Voting escrows sXLM, returned when voting closes. A
timelock separates passing from taking effect.

### 8. Backend bypassed governance with the admin key

After a proposal executed, the backend re-applied the parameter using the admin key via the old admin
setters — the exact trust hole governance exists to close. It was also already broken: its parameter
names no longer matched, so every call silently fell through.

**Fixed.** Removed, along with the four helper functions behind it. No admin-key path for vault or
lending parameters remains in the backend.

### 9. LP swap fees went to the admin, not to holders

The pool charged 5 bps on swaps and routed 100% of it to the admin key.

**Fixed.** Split 80/20 to the vault and admin, and made collectable by anyone since it only moves
fees to fixed destinations.

### 10. Liquidation divided by a rate that can be zero

Making lending read the vault removed a guarantee: the vault can legitimately return zero when shares
are outstanding against no assets. `liquidate()` divided by it.

**Fixed.** Explicit refusal with a clear message rather than an arithmetic error.

### 11. Documentation described a different protocol

The published sXLM address was **the native XLM Stellar Asset Contract**, not the token. Precision
claimed Wad (10^18) and Ray (10^27) where the code uses 10^7. An insurance fund, strategy registry,
oracle stack and buffer targeting were documented with zero implementation.

**Fixed.** Address corrected, precision stated honestly, unbuilt subsystems removed and replaced with
a *Current Limits* section, and all yield claims removed until the yield sources existed.

## Permissions as they now stand

| Actor | Can | Cannot |
|---|---|---|
| Any user | Deposit, withdraw, claim, borrow, repay, liquidate, flash loan | Move the exchange rate |
| Keeper | Bump TTL, harvest, settle interest | Move user funds |
| Admin | Upgrade any contract, pause, withdraw accrued fees, set parameters | Set the exchange rate, mint sXLM |
| Governance | Change ten named parameters after a vote and timelock | Anything not on that list |

**The admin key remains a single Stellar account.** It can upgrade any contract, and new code can
ignore every invariant above. Moving it to a multisig is the largest outstanding item.

## Invariants now covered by tests

- Depositing does not dilute existing holders; shares are floored toward the pool
- Withdrawing burns shares and records the payout as a liability in the same call
- No entrypoint sets the exchange rate; it is computed from balances on every read
- The rate cannot rise unless XLM has already been transferred in
- Protocol fees are excluded from share backing until withdrawn
- The first 1,000 shares are locked and can never be redeemed
- Lending values sXLM by calling the vault, never from a stored or admin-set number
- Flash loans cannot be repaid by depositing the loan (reentrancy guard)
- Storage keys are name-addressed, so removed enum variants orphan safely on upgrade
