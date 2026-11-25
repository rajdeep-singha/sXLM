# Blockers & Lessons Learned — August 2026 Sprint

Sprint focus: accounting/permission hardening of the live protocol on Stellar mainnet.
Contract tests went **6 → 86**; all findings fixed and redeployed by upgrade on
2026-08-31 with balances preserved.

## Blockers resolved

- **Live mainnet accounting defect.** The exchange rate read **5.69% high** — queued
  withdrawals burned shares without recording the XLM owed. Fixed by recording the
  liability in the same call; migration reconstructed it to the exact stroop.
- **Rate could inflate with no assets behind it (critical).** A treasury counter could
  be credited without transferring XLM. Removed it; `total_assets` is now derived from
  balances on every read.
- **Governance was decorative and admin-bypassable.** Rebuilt with escrowed voting,
  mandatory quorum, a 24h timelock, and direct execution; the admin-key backdoor was
  deleted.
- **CI build breaks.** Bumped `ethnum` (WASM compile failure) and `stellar-sdk` to v17
  after the Soroban RPC endpoint went dead.

## Blockers still open

- **Single-key admin custody** — one account is admin on all five contracts and the
  keeper key, with no recovery path. Moving to a multisig is the top open item.
- **Deployed source not verified** — on-chain bytecode isn't yet matched to the repo
  (~1 hour, free).
- **No infra redundancy** — single RPC/Horizon endpoints; only 1 of 7 required monitoring
  alerts is live.

## Lessons learned

- **Derive state, don't store it.** Every rate-manipulation bug traced to a stored number that could drift from real holdings; deriving `total_assets` killed the whole class at once.
- **Docs drift is a security surface.** Aspirational, unbuilt features were documented as real. We cut ~2,765 lines of unbuilt subsystems and now under-promise by rule.
- **Rehearse upgrades against live state** — the mainnet migration was validated on a testnet replica first.
- **The cheapest audit wins are non-code** — source verification and multisig need no new contract code.
