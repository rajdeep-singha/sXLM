# StelloFi — Instawards SOW 2
## Production Security Controls & Operational Hardening

**Program:** CoInstawards (follow-on; second and final Instaward)  
**Chapter:** India — Ambassador Chapter Lead: Sahitya Roy  
**Date:** October 2026  
**Window:** 30 calendar days  
**Requested amount:** **$4,500 USD**  
**Constraint:** Fully technical. No marketing, content, giveaways, or growth spend.

This SOW follows the same Instawards structure as SOW 1 (*StelloFi Mainnet Stabilization & Audit Readiness Sprint*, submitted June 1, 2026). It does not repeat that work.

---

## 1. Project & Team Info

| Field | Value |
|---|---|
| Project name | StelloFi — Production Security Controls & Operational Hardening |
| Builder / team | Rajdeep Singha and Rudransh |
| Primary contact | singha384@gmail.com |
| Ambassador chapter | India |
| Chapter lead | Sahitya Roy |
| Network | Stellar mainnet (Soroban) |
| Live product | stellofi.com |
| Prior Instaward | SOW 1 — Mainnet Stabilization & Audit Readiness (June 2026). Delivered. |
| Suggested start | On approval |

### What already exists (do not re-fund)

SOW 1 delivered, and the August 2026 sprint closed, the following. They are complete and are **not** in this budget:

- Mainnet deployment register (contract IDs, WASM hashes, roles, services, live vault state)
- Accounting and permission review (11 findings fixed; 6 → 86 contract tests; upgrade on 2026-08-31)
- Transparency and operations pack (monitoring *requirements*, keeper and incident runbooks, audit-readiness summary)
- Internal yield paths (borrow interest, swap fees, withdrawal fee, flash-loan fee, liquidation surcharge)

SOW 1 also named the next step as **mainnet audit and remediation**. This SOW is that step, scoped to what $4,500 can actually finish in 30 days.

---

## 2. Instawards Overview & Intent

Instawards support short, clearly scoped, execution-focused work with outcomes that can be demonstrated in 30 days or less. This SOW is a shared commitment between the builders and the Ambassador Chapter Lead on what will be delivered, why it matters, and how success is verified.

### Purpose (for builder context)

StelloFi is live on Stellar mainnet. The first Instaward made the live system reviewable. The remaining blockers are operational, not documentary:

1. One Stellar account is admin on all five contracts **and** the keeper key. There is no recovery path.
2. Governance is deployed but not wired. Parameter control still sits with that same key.
3. Six of seven required production alerts are not live. Only the solvency check runs.
4. RPC and Horizon are single public endpoints. TTL bumping depends on one backend.
5. Source is not verified on public explorers. The protocol is unaudited.
6. The withdrawal queue is a single map and fails in the hundreds of entries.

None of these were in SOW 1 scope. Key custody was explicitly out of scope then. They are the work this award funds.

---

## 3. Problem Statement & Objectives

### Problem being addressed

The protocol’s security today is the security of one key. The operations pack already states this, and an auditor will open here. Until that key is a multisig, the keeper is a separate signer, governance is actually in control, and the six missing alerts fire, the August hardening is reversible by a single signature or a silent outage.

This Instaward is intended to close those production-security and operational gaps — not to add a new product surface.

### Objective (what will be true in 30 days)

If this Instaward succeeds, StelloFi will have:

- a multisig as admin on all five contracts, with the keeper on a separate key;
- `set_governance` called on every contract that accepts it;
- source verified against the deployed WASM hashes;
- the six missing alerts live, plus a second RPC/Horizon path;
- a withdrawal-queue storage change that does not fail at hundreds of entries, covered by property tests.

### Scope note

Limited to improvements that can be completed and demonstrated within 30 calendar days. If a line starts to exceed that, it is cut rather than stretched.

---

## 4. Scope of Work (30-Day Deliverable)

### In scope

| # | Deliverable | What will be built | Why this matters |
|---|---|---|---|
| 1 | Admin multisig + keeper key split | Threshold / multisig Stellar account becomes admin on Vault, sXLM, Lending, LP Pool, and Governance. Keeper signs from a new, non-admin key. `set_admin` and keeper env cutover rehearsed on a testnet replica of live state, then executed on mainnet. Recovery runbook updated. | Converts an unrecoverable key-compromise into a survivable event. Highest-value open item in the operations pack. |
| 2 | Governance wired | `set_governance` called on each contract that still answers to the admin key for parameters. After this, fee / cooldown / collateral / utilisation changes require a passed proposal and the 24h timelock. | Governance is deployed and unused. Until this call lands, the rewrite from SOW 1 is decorative again. |
| 3 | Source verification | Match on-chain WASM hashes to this repository on a public explorer (stellar.expert or equivalent). Publish the verification record next to the deployment register. | Stated blocker. Free on-chain, but required before any serious review. |
| 4 | Production alert set | Ship the six alerts the operations pack already specified: exchange-rate fall, contract TTL < 7 days, keeper silence > 12h, reserve utilisation > 85%, any non-keeper admin-key call, pending withdrawal stale > 30 days. Each alert has a threshold, a destination (existing Slack / webhook), and a test fire. | Only solvency is live today. Silent keeper failure is currently invisible until a contract archives. |
| 5 | RPC / Horizon failover | Primary + fallback Soroban RPC and Horizon endpoints in the backend. Failover tested. 30 days of a paid RPC plan so TTL bumps and solvency reads do not depend on the public endpoint staying up. | Single public RPC is the other infra single point of failure. |
| 6 | Withdrawal-queue scale + property tests | Replace the single-map queue with a storage layout that remains callable as entries grow. Add property / invariant tests for deposit–withdraw symmetry, rate-never-rises-without-inflow, and queue liability accounting. | Known contract limit. The audit plan already lists property-based and economic stress testing as outstanding. |

### Out of scope (explicitly not included)

- Marketing, social threads, creator explainers, giveaways, pilot-user rewards, brand or UI assets
- Liquidity mining, pool incentives, or any XLM posted as “growth”
- Blend or any other external strategy (needs an oracle and a clean security baseline first)
- A commercial firm audit (cannot be bought honestly at this budget; see §7)
- Legal opinions, insurance fund, or any yield guarantee
- Frontend redesign
- Repeating the deployment register, accounting review, or operations pack from SOW 1

---

## 5. Budget Request

**Total requested: $4,500 USD**

Every line is engineering, infrastructure, or a paid technical review. Nothing is marketing. **No single line is above $600.**

| Line | Amount | What the money buys | Why this is new (not SOW 1) |
|---|---|---|---|
| 1. Multisig design + testnet `set_admin` rehearsal | $500 | Threshold account design and a full `set_admin` rehearsal on a testnet replica of live state, before any mainnet key move. | SOW 1 listed private-key custody as out of scope. |
| 2. Mainnet admin cutover + recovery runbook | $550 | `set_admin` on all five contracts to the multisig, plus the written recovery path if the old key is later suspected compromised. | Same single key is still admin on all five contracts. |
| 3. Keeper key split and redeploy | $500 | New non-admin keeper key, env cutover, and proof the keeper is alive on the new signer. | Keeper and admin are the same account today. |
| 4. Wire `set_governance` | $500 | Call `set_governance` on every contract that still takes parameter changes from the admin key. | Governance is deployed and unused. |
| 5. Alerts: exchange-rate, TTL, keeper liveness | $500 | Three of the six missing signals, each with a threshold, Slack/webhook destination, and a test fire. | Operations pack documented these. Only solvency runs. |
| 6. Alerts: utilisation, admin-key activity, stale withdrawals | $500 | The other three missing signals, same wiring and test fires. | Same gap; split so no alert line exceeds $600. |
| 7. Paid Soroban RPC + Horizon failover (30 days) | $450 | Paid RPC credits and failover code so TTL bumps and solvency reads survive a public-endpoint outage. | Current RPC is `mainnet.sorobanrpc.com` with no fallback. |
| 8. Withdrawal-queue storage change + upgrade rehearsal | $550 | Replace the single-map queue; rehearse the upgrade on a testnet replica of live state. | Known scale limit. Not in SOW 1. |
| 9. Property / invariant tests + source verification | $450 | Property tests for share accounting and queue liabilities, plus explorer verification of the five WASM hashes. | Audit-plan items. Source is still unverified. |
| **Total** | **$4,500** | | |

### What we are not asking for (and why)

| Tempting line | Why it is excluded |
|---|---|
| sXLM/XLM pool / liquidity | SOW 1 already had a pool-support line. This award is not a liquidity program. |
| Creator threads, giveaways, feedback rewards | Marketing. Disallowed for this SOW. |
| Frontend / dashboard graphics | Marketing-adjacent. Disallowed. |
| “Full audit” at $4,500 | Not honest. A Soroban audit of five live contracts is a later, larger raise (SCF or equivalent). |
| Blend strategy adapter | Product expansion. Needs the security baseline this SOW creates. Named as the step *after* this award. |
| Hosting (Vercel / Render / Postgres) | Already running from prior work. Not a new technical outcome. |

### If the chapter prefers to use the $5,000 cap

Add **$450** as “mainnet upgrade and rehearsal fees” (testnet replica hosting + Soroban resource fees for the queue upgrade and the five `set_admin` / `set_governance` calls). That brings the ask to **$4,950**. Do not add marketing to fill the gap.

---

## 5.1 Weekly Breakdown

| Week | Planned work | Expected output |
|---|---|---|
| 1 | Multisig account, keeper key, testnet replica of live admin/governance state. Alert stubs and RPC failover behind flags. | Testnet `set_admin` / `set_governance` rehearsal log. Key-split design note. |
| 2 | Mainnet key migration. Wire governance. Verify source on the explorer. Cut keeper over to the new key. Enable RPC failover. | Explorer verification links. Five `set_admin` tx hashes. Keeper liveness on the new key. |
| 3 | Ship the six alerts with test fires. Implement queue storage change on testnet; property tests green. | Alert test-fire evidence. Queue PR + passing property suite. |
| 4 | Queue upgrade rehearsal, then mainnet upgrade if tests hold. Independent review. Evidence pack and chapter walkthrough. | Upgrade tx / or a written hold-back if tests fail. Reviewer notes. 30-day recap. |

If the queue upgrade is not safe by week 4, it stays on testnet and is reported as such. We will not upgrade a live vault to hit a date.

---

## 6. Evidence to Be Submitted

| Deliverable | Evidence type | What the chapter lead should see |
|---|---|---|
| Multisig + keeper split | Explorer links, tx hashes | New admin account is a multisig / threshold account. Old single key is no longer admin on any of the five contracts. Keeper public key ≠ admin public key. |
| Governance wired | Tx hashes | `set_governance` on each target contract. A parameter change without a passed proposal fails. |
| Source verification | Public explorer links | Each of the five WASM hashes in the deployment register matches verified source. |
| Alert set | Repo + test-fire artifacts | Six alerts present in code. One recorded test fire per alert (Slack / webhook). |
| RPC failover | Config + failover test note | Two endpoints configured. A forced primary failure still completes a read or TTL bump. |
| Queue + property tests | PR, test output, (if safe) upgrade hash | Tests pass. If upgraded, new WASM hash recorded. If not, testnet evidence and the reason. |
| Independent review | Written notes | Reviewer name, scope (five contracts + key migration), findings, and what was fixed in-window. |

### Verification checklist (for the chapter lead)

- [ ] Admin is no longer `GDWXTIIR…VZ5N` on all five contracts
- [ ] Keeper key is distinct from admin
- [ ] Governance controls parameters on the wired contracts
- [ ] Source verified for Vault, sXLM, Lending, LP Pool, Governance
- [ ] Six new alerts have a test fire
- [ ] RPC/Horizon has a documented fallback
- [ ] Property tests exist and pass in CI
- [ ] No marketing, reward, or liquidity spend appears in the evidence pack

---

## 7. Next-Step Plan

### 7.1 Anticipated next step (after this award)

This is the second Instaward. Instawards are capped at two, so the next step is **not** another Instaward.

Most likely next step, in order:

1. **Apply independently** to a larger Stellar program (SCF or equivalent) for a commercial Soroban audit and remediation of that audit.
2. **Only after the audit:** a Blend (or equivalent) strategy adapter — the first external yield path. It needs an oracle and the security baseline this SOW creates. It was out of scope in SOW 1 and stays out of scope here.
3. Seek other ecosystem technical support if the audit raise is delayed.

We will not use leftover Instaward eligibility language. Two is the cap.

---

## 8. Acknowledgements

By submitting this SOW we confirm:

- This is a scoped 30-day engagement, not an open retainer.
- A project may receive no more than two Instawards. This is the second.
- The request is capped at $5,000 and this ask is $4,500.
- No line is marketing, growth, or user rewards.
- Success is verified by the evidence in §6, not by TVL, users, or social reach.

---

## Appendix — Live system this SOW attaches to

| Contract | Mainnet address |
|---|---|
| sXLM Token | `CCGFHMW3NZD5Z7ATHYHZSEG6ABCJADUHP5HIAWFPR37CP4VGNEDQO7FJ` |
| Vault | `CDYXKWVDGEVA6OSIGN7GRAPPRN6AKID35OJL5ZZQIBCMECZ35KGL45PS` |
| LP Pool | `CAW2DRMOI3CCJWKVMEUWYJUEQHXB4S4DR72HNL2DWQCMQQUH3LFFVLHV` |
| Lending | `CAOWXZ6BWA2ZYY7GHD75OFKADKUJS4WCKPDYGGXULQWFJRB55TXAQNJG` |
| Governance | `CB7LV3FBQ7US26GVC7SM7RMX22IEEHAEUL7V3TDDWM32DHA5TDFDDEP4` |

Current admin and keeper (to be replaced): `GDWXTIIROGCVBSNQMBJFH6HOWQ4YSRVMKSUS53CH6MP56WSWD6J4VZ5N`  
Frontend: stellofi.com · Backend: sxlm.onrender.com  
Source of truth for roles and vault state: `docs/DEPLOYMENT_REGISTER.md`  
Open blockers this SOW closes: `docs/OPERATIONS.md`, `docs/SPRINT_AUGUST_RETRO.md`
