# Instawards SOW 2 — Evidence Index

Where the evidence for each deliverable lives. "Pending" items need a signature or an account only
the team holds; the procedure for each is in `docs/MAINNET_CUTOVER.md`.

## Deliverable 1: Admin multisig, keeper split, governance wiring

| Evidence | Where | State |
|---|---|---|
| Keeper on its own key, permissionless calls only | `backend/src/keeper/`, `backend/tests/keeper.test.ts` (checks each keeper method against the contract source) | Done; deployed |
| Keeper public key is not the admin key | Keeper `GBT4TLLF…OQKV`, admin `GDWXTIIR…VZ5N`; the backend refuses to start the keeper with the admin key | Done |
| Keeper liveness on the new key | Horizon transactions of the keeper account; `/health` `keeper.lastTtlBumpAt` | Pending: keeper not yet running in production |
| Multisig tooling that refuses lockout plans | `backend/src/multisig/`, `backend/tests/multisig.test.ts` | Done |
| Multisig rehearsal: conversion, one signature refused, two accepted | `docs/evidence/testnet-rehearsal.md`, sections 2–4 | Done on testnet |
| Admin rotation available on all five contracts | `set_admin` in every contract, two-party; tests `admin_rotation_needs_both_keys` | Done in version 3 |
| Governance bypass closed | Tests `legacy_setters_answer_to_governance_once_set` (lending), `the_cooldown_setter_answers_to_governance_once_set` (vault), `parameters_answer_to_governance_once_set` (LP); rehearsal section 5 | Done in version 3 |
| `set_governance` on vault, token, lending, LP pool | Rehearsal section 5 (testnet hashes) | Mainnet pending: cutover step 6 |
| Governance proposal executed end to end | Rehearsal section 6 | Done on testnet |
| Mainnet conversion and upgrade hashes | `docs/DEPLOYMENT_REGISTER.md` after cutover | Pending: signers |
| Recovery runbook | `docs/OPERATIONS.md`, *Admin key compromise* | Done |
| Timed compromise-recovery drill | Rehearsal section 8 (seconds from decision to verified rotation) | Done on testnet |

## Deliverable 2: Production alerts and RPC / Horizon failover

| Evidence | Where | State |
|---|---|---|
| Six alerts plus solvency, each with a threshold | `backend/src/monitor/checks.ts`; table in `docs/OPERATIONS.md` | Done |
| Every threshold unit-tested | `backend/tests/monitor.test.ts` | Done |
| Live evaluation against mainnet | `npm run alerts -- check` on 2026-11-23: three stale withdrawals, 88.68% utilisation, silent keeper | Done |
| One recorded test fire per alert | `npm run alerts -- test-fire all` output | Pending: needs `SLACK_WEBHOOK_URL` or `ALERT_WEBHOOK_URL` |
| Two or more RPC and Horizon endpoints | Three RPC and two Horizon endpoints by default (`backend/src/config/index.ts`); frontend the same | Done |
| Forced primary failure still completes a read | `backend/tests/network.test.ts`: refused, 503 and dropped primary endpoints, call completes on the fallback; observed live when `mainnet.sorobanrpc.com` refused connections on 2026-11-23 | Done |
| 30 days of a paid RPC plan | Provider choice and purchase | Pending: team decision |

## Deliverable 3: Withdrawal-queue scale, property tests, source verification

| Evidence | Where | State |
|---|---|---|
| Queue storage that stays callable as entries grow | Vault version 3; test `claims_stay_cheap_as_requests_accumulate` (400 requests, flat claim cost) | Done in version 3 |
| Legacy queue migration | `migrate_withdrawals`; tests seeded with the five mainnet entries | Done in version 3 |
| Property tests: deposit-withdraw symmetry, rate never rises without inflow, queue liability | `contracts/vault/src/lib.rs` `mod properties`; `contracts/lending/src/lib.rs` `mod properties` | Done; run in CI |
| Upgrade safety against live storage | Tests `reads_the_live_mainnet_storage_unchanged` and `the_live_pool_resumes_protocol_fees_after_upgrade` | Done |
| State preserved across the upgrade | Rehearsal section 3, before/after comparison | Done on testnet |
| Verified source for the five WASM hashes | `.github/workflows/release-contracts.yml`; stellar.expert after upload | Pending: tag push and mainnet upgrade |
