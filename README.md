# StelloFi

An XLM vault on Stellar, built on Soroban. Deposit XLM to receive **sXLM**, a share token representing a proportional claim on pooled XLM, redeemable at the vault rate and usable as collateral in the lending market.

Deployed on Stellar mainnet. Source is not verified on public explorers and the protocol is unaudited.

---

## Documentation

| Document | Covers |
|----------|--------|
| [Deployment Register](docs/DEPLOYMENT_REGISTER.md) | Contract IDs, WASM hashes, roles, services, live vault state |
| [Accounting and Permission Review](docs/ACCOUNTING_REVIEW.md) | Findings from the August 2026 review and how each was resolved |
| [Operations Pack](docs/OPERATIONS.md) | Monitoring requirements, keeper and incident runbooks, audit readiness |

---
## User FeedBack
<img width="1173" height="736" alt="image" src="https://github.com/user-attachments/assets/0795de6d-ccb6-47c9-9c8e-1b6c800fd3c8" />

## Architecture

The project is a monorepo with three main components:

| Component | Description |
|-----------|-------------|
| **contracts** | Soroban smart contracts (Rust). sXLM token, vault, lending, LP pool, and governance. |
| **backend** | Node.js API and off-chain services. Handles indexing, exchange-rate snapshots, solvency monitoring and keeper logic. |
| **frontend** | React SPA. Stake, withdraw, analytics, lending, liquidity, governance, docs. |

- **Chain:** Stellar (Soroban). Default configuration targets Stellar **mainnet**.
- **Data:** PostgreSQL (Prisma) for metrics, withdrawals, positions and governance; Redis for event bus.
- **Wallet:** Stellar Freighter (frontend); backend uses admin keypair for contract interactions.

---

## Deployed contract addresses

| Contract | Address |
|----------|---------|
| sXLM Token | `CCGFHMW3NZD5Z7ATHYHZSEG6ABCJADUHP5HIAWFPR37CP4VGNEDQO7FJ` |
| Vault | `CDYXKWVDGEVA6OSIGN7GRAPPRN6AKID35OJL5ZZQIBCMECZ35KGL45PS` |
| LP Pool | `CAW2DRMOI3CCJWKVMEUWYJUEQHXB4S4DR72HNL2DWQCMQQUH3LFFVLHV` |
| Lending | `CAOWXZ6BWA2ZYY7GHD75OFKADKUJS4WCKPDYGGXULQWFJRB55TXAQNJG` |
| Governance | `CB7LV3FBQ7US26GVC7SM7RMX22IEEHAEUL7V3TDDWM32DHA5TDFDDEP4` |

Backend `.env`:

```
SXLM_TOKEN_CONTRACT_ID=CCGFHMW3NZD5Z7ATHYHZSEG6ABCJADUHP5HIAWFPR37CP4VGNEDQO7FJ
STAKING_CONTRACT_ID=CDYXKWVDGEVA6OSIGN7GRAPPRN6AKID35OJL5ZZQIBCMECZ35KGL45PS
LP_POOL_CONTRACT_ID=CAW2DRMOI3CCJWKVMEUWYJUEQHXB4S4DR72HNL2DWQCMQQUH3LFFVLHV
LENDING_CONTRACT_ID=CAOWXZ6BWA2ZYY7GHD75OFKADKUJS4WCKPDYGGXULQWFJRB55TXAQNJG
GOVERNANCE_CONTRACT_ID=CB7LV3FBQ7US26GVC7SM7RMX22IEEHAEUL7V3TDDWM32DHA5TDFDDEP4
```

For the frontend, set the same IDs with the `VITE_` prefix (e.g. `VITE_SXLM_TOKEN_CONTRACT_ID`, `VITE_STAKING_CONTRACT_ID`, etc.).

---

## Yield

sXLM appreciates when XLM is added to the vault without new shares being minted. Five sources do that, all internal to the protocol:

| Source | Rate | Depends on |
|--------|------|------------|
| Borrow interest | 5% annual, 80% to holders | Amount borrowed |
| Swap fees | 5 bps protocol cut, 80% to holders | Trading volume |
| Withdrawal fee | 10 bps, kept by the vault | Exits |
| Flash loan fee | 5 bps | Arbitrage |
| Liquidation surcharge | 1% from the liquidator | Liquidations |

No external strategy is implemented — nothing is routed to Blend or any other protocol. All five scale with **activity, not deposits**, so depositing more XLM does not increase them. With little borrowing or trading they are close to zero.

The exchange rate cannot rise without XLM arriving first, and no admin path sets it. APY shown in the app is derived from realised rate history, not projected.

---

## Prerequisites

- **Node.js** 20+ (backend and frontend)
- **Rust** and **Soroban CLI** (contracts; [Stellar Soroban docs](https://soroban.stellar.org/docs))
- **PostgreSQL** and **Redis** (for backend)
- **pnpm** or **npm** (package manager)

---

## Getting Started

### 1. Smart Contracts (Rust / Soroban)

From the repository root:

```bash
cd contracts
cargo build
```

Workspace members:

- `sxlm-token` — sXLM vault share token
- `vault` — deposit, withdraw, share accounting
- `lending` — collateralized lending
- `lp-pool` — XLM/sXLM liquidity pool
- `governance` — parameter proposals and voting

Deploy and configure contract IDs per your network (testnet/mainnet) and set the same IDs in backend and frontend environment variables.

### 2. Backend

```bash
cd backend
npm install
# Create .env with required variables (see Environment Variables below)
npx prisma generate
npx prisma migrate dev   # or db push for prototyping
npm run dev
```

Default dev server: `http://localhost:3001`.

The seed script inserts nothing. Metrics and reward snapshots come from on-chain reads.

### 3. Frontend

```bash
cd frontend
npm install
# Set VITE_* env vars if needed (see Environment Variables)
npm run dev
```

Default dev server: `http://localhost:5173`.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string (event bus) |
| `STELLAR_RPC_URL` | Soroban RPC endpoint |
| `STELLAR_NETWORK_PASSPHRASE` | Network passphrase (`Public Global Stellar Network ; September 2015` for mainnet) |
| `STELLAR_HORIZON_URL` | Horizon API URL |
| `SXLM_TOKEN_CONTRACT_ID` | Deployed sXLM token contract ID |
| `STAKING_CONTRACT_ID` | Deployed vault contract ID (name kept for deployment compatibility) |
| `LENDING_CONTRACT_ID` | Deployed lending contract ID |
| `LP_POOL_CONTRACT_ID` | Deployed LP pool contract ID |
| `GOVERNANCE_CONTRACT_ID` | Deployed governance contract ID |
| `PORT` | API port (default `3001`) |
| `HOST` | Bind host (default `0.0.0.0`) |
| `ADMIN_SECRET_KEY` | Admin secret key for contract txs |
| `ADMIN_PUBLIC_KEY` | Admin public key |
| `JWT_SECRET` | Secret for JWT auth |
| `JWT_EXPIRES_IN` | JWT expiry (e.g. `24h`) |
| `GOVERNANCE_WEBHOOK_URL` | Optional webhook for governance events |
| `SLACK_WEBHOOK_URL` | Optional Slack webhook |

### Frontend (`frontend/.env`)

Prefix with `VITE_` so Vite exposes them to the client:

| Variable | Description |
|----------|-------------|
| `VITE_NETWORK_NAME` | e.g. `MAINNET` |
| `VITE_NETWORK_PASSPHRASE` | Stellar network passphrase |
| `VITE_HORIZON_URL` | Horizon URL |
| `VITE_SOROBAN_RPC_URL` | Soroban RPC URL |
| `VITE_SXLM_TOKEN_CONTRACT_ID` | sXLM token contract ID |
| `VITE_STAKING_CONTRACT_ID` | Vault contract ID (name kept for deployment compatibility) |
| `VITE_LENDING_CONTRACT_ID` | Lending contract ID |
| `VITE_LP_POOL_CONTRACT_ID` | LP pool contract ID |
| `VITE_GOVERNANCE_CONTRACT_ID` | Governance contract ID |
| `VITE_API_URL` | Backend API base URL (e.g. `http://localhost:3001`) |

---

## Project Structure

```
StelloFi/
├── contracts/                # Soroban contracts (Rust workspace)
│   ├── sxlm-token/
│   ├── vault/
│   ├── lending/
│   ├── lp-pool/
│   └── governance/
├── backend/                  # Node.js API and services
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts
│   └── src/
│       ├── api-gateway/      # Fastify server and routes
│       ├── vault-engine/     # contract client, tx execution, withdrawal queue
│       ├── reward-engine/    # exchange-rate snapshots, derived APR
│       ├── risk-engine/      # solvency watch
│       ├── event-listener/
│       ├── event-bus/
│       ├── user-service/
│       ├── metrics-cron/
│       ├── keeper/
│       └── config/
└── frontend/                 # React + Vite SPA
    └── src/
        ├── components/
        ├── pages/
        ├── hooks/
        ├── lib/
        ├── utils/
        └── config/
```

---

## Backend Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Dev | `npm run dev` | Run with tsx watch |
| Build | `npm run build` | TypeScript compile to `dist/` |
| Start | `npm start` | Run `dist/index.js` |
| DB generate | `npm run db:generate` | Prisma generate client |
| DB migrate | `npm run db:migrate` | Prisma migrate dev |
| DB push | `npm run db:push` | Prisma db push |
| DB studio | `npm run db:studio` | Prisma Studio |
| Seed | `npm run seed` | Run seed script |
| Test | `npm run test` | Vitest |
| Lint | `npm run lint` | TypeScript check |

---

## Frontend Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Dev | `npm run dev` | Vite dev server |
| Build | `npm run build` | TypeScript + Vite build |
| Preview | `npm run preview` | Preview production build |
| Lint | `npm run lint` | ESLint |

---

## Deployment

- **Backend:** `backend/nixpacks.toml` defines build and start (Prisma generate, build, migrate deploy, then `node dist/index.js`). Use with Nixpacks or adapt for your platform.
- **Frontend:** Build with `npm run build` and serve the `dist/` output with any static host; set `VITE_API_URL` to your backend URL.
- **Contracts:** Deploy each contract to your target Stellar network and record contract IDs in backend and frontend env.

## CI/CD

GitHub Actions runs backend and frontend checks on pull requests. Pushes to `main` run the same checks, then deploy the backend to Render and the frontend to Vercel.

Required GitHub repository secrets:

| Secret | Used for |
|--------|----------|
| `RENDER_BACKEND_DEPLOY_HOOK_URL` | Render backend deploy hook |
| `VERCEL_TOKEN` | Vercel CLI authentication |
| `VERCEL_ORG_ID` | Vercel team/user ID |
| `VERCEL_PROJECT_ID` | Vercel frontend project ID |

<img width="1854" height="942" alt="image" src="https://github.com/user-attachments/assets/da08869b-bc1b-416a-b9bc-6c28b639c664" />

Backend production environment variables belong in Render. Frontend production environment variables belong in Vercel. Do not commit local `.env` files.

If Vercel's Git integration is also connected to this repository, disable automatic production deploys there to avoid duplicate deploys from both Vercel and GitHub Actions.

---

## License

See repository license file.
