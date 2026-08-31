# Deployment Register

Stellar mainnet. Read from the chain on 2026-08-31, not from configuration files.

## Contracts and deployed artifacts

| Contract | Address | WASM sha256 | Size |
|---|---|---|---|
| Vault | `CDYXKWVDGEVA6OSIGN7GRAPPRN6AKID35OJL5ZZQIBCMECZ35KGL45PS` | `d981274684cd0bd1…` | 19,059 B |
| sXLM Token | `CCGFHMW3NZD5Z7ATHYHZSEG6ABCJADUHP5HIAWFPR37CP4VGNEDQO7FJ` | `3bd9aa86a2349ef1…` | 7,812 B |
| Lending | `CAOWXZ6BWA2ZYY7GHD75OFKADKUJS4WCKPDYGGXULQWFJRB55TXAQNJG` | `fe0c999b04b5a298…` | 17,819 B |
| LP Pool | `CAW2DRMOI3CCJWKVMEUWYJUEQHXB4S4DR72HNL2DWQCMQQUH3LFFVLHV` | `a895bd9e243e3643…` | 13,077 B |
| Governance | `CB7LV3FBQ7US26GVC7SM7RMX22IEEHAEUL7V3TDDWM32DHA5TDFDDEP4` | `acf5bdebcfee8ceb…` | 11,781 B |

Addresses are unchanged since first deployment on 2026-02-23. The code behind each was replaced by
upgrade on 2026-08-31; storage, balances and token holders were preserved.

Source is **not yet verified** on public explorers. The hashes above are the means to check it once it is.

## Roles

`GDWXTIIROGCVBSNQMBJFH6HOWQ4YSRVMKSUS53CH6MP56WSWD6J4VZ5N` is contract admin on all five contracts
**and** the account the keeper signs with. It is a single Stellar account, not a multisig. It can
upgrade every contract, pause the vault, withdraw accrued fees, and set every parameter.

Governance is deployed but `set_governance` has not been called on any contract, so parameter control
still sits with the admin key.

| Role | Holder | Can do |
|---|---|---|
| Admin (×5) | `GDWXTIIR…VZ5N` | Upgrade any contract, pause, withdraw fees, set all parameters |
| Keeper | `GDWXTIIR…VZ5N` | TTL bumps every 24h, harvest every 6h — same key as admin |
| Minter | Vault contract | Only the vault mints or burns sXLM; changing it is governance-gated |
| Governance | Deployed, not wired | Escrowed voting, quorum, 24h timelock — controls nothing yet |

## Services and providers

| | |
|---|---|
| Frontend | stellofi.com — Vercel, deployed from `main` by GitHub Actions |
| Backend | sxlm.onrender.com — Render, deploy hook from GitHub Actions |
| Soroban RPC | `https://mainnet.sorobanrpc.com` |
| Horizon | `https://horizon.stellar.org` |
| Database | PostgreSQL on Render (Prisma) |
| Keeper cadence | TTL bump 24h · harvest 6h · solvency check 5min |
| **Strategy addresses** | **None.** No capital is deployed to any external protocol |

RPC and Horizon are single public endpoints with no fallback. TTL bumping depends on the backend
staying up; if it stops for roughly 30 days the contracts archive and become uncallable until restored.

## Vault state

| Reading | Value | Note |
|---|---|---|
| `idle_balance` | 707,565,055 | 70.7565055 XLM actually held |
| `pending_withdrawals` | 38,114,885 | 3.8114885 XLM owed on three unclaimed exits |
| `total_assets` | 669,450,170 | Derived: idle + deployed − pending − treasury |
| `total_sxlm_supply` | 329,453,105 | Includes 1,000 permanently locked shares |
| `get_exchange_rate` | 20,320,044 | 2.0320044 XLM per sXLM |
| `treasury_balance` | 0 | No protocol fees accrued |
| `is_paused` | false | Open |

### Live parameters

| | |
|---|---|
| Protocol fee | 1000 bps |
| Withdrawal fee | 10 bps |
| Flash loan fee | 5 bps |
| Cooldown | 181,440 ledgers (~10.5 days) |
| Collateral factor | 7500 bps |
| Liquidation threshold | 8000 bps |
| Borrow rate | 500 bps |
| Reserve utilisation cap | 9000 bps |
| Liquidation surcharge | 100 bps |
| Interest share to holders | 8000 bps |

Lending: 6.2000031 XLM borrowed against 0.7999969 XLM of pool liquidity. The pool has lent out more
than it currently holds — ordinary for a lending market, but there is no headroom for new borrowing
or for suppliers to exit until loans are repaid.
