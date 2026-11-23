#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, BytesN, Env, Map, Symbol, Vec,
};

/// Storage layout version. Reported by `version()` so an upgrade can be checked
/// from outside without reading code.
const CONTRACT_VERSION: u32 = 3;

/// Most withdrawal requests one account may have open at once. Each is its own
/// storage entry; the cap keeps the per-account index small enough to load in
/// one call however many requests the vault handles overall.
const MAX_OPEN_WITHDRAWALS_PER_USER: u32 = 50;

/// Precision multiplier for exchange rate calculations (7 decimals).
///
/// 1e7 matches Stellar stroops. This is deliberate: the vault never holds a
/// value more precise than a stroop, so a wider fixed-point scale would add
/// digits that cannot correspond to anything the contract can actually pay out.
const RATE_PRECISION: i128 = 10_000_000; // 1e7

/// Default protocol fee in basis points (1000 = 10%). Governance may change it.
const DEFAULT_PROTOCOL_FEE_BPS: i128 = 1000;
const BPS_DENOMINATOR: i128 = 10_000;

/// Shares burned to the contract itself on the first deposit so that the share
/// price can never be manipulated by donating to an empty vault.
const MINIMUM_LIQUIDITY: i128 = 1000;

/// Fee on withdrawal, kept by the vault.
///
/// This is not protocol revenue. It stays in the pool, so it is a transfer from
/// whoever is leaving to whoever stays — which is the right way round, because
/// leaving is what consumes the vault's liquidity.
const DEFAULT_WITHDRAWAL_FEE_BPS: i128 = 10; // 0.10%

/// Fee on a flash loan, also kept by the vault.
const DEFAULT_FLASH_FEE_BPS: i128 = 5; // 0.05%

// ---------- TTL constants ----------
const INSTANCE_LIFETIME_THRESHOLD: u32 = 100_800;   // ~7 days
const INSTANCE_BUMP_AMOUNT: u32        = 518_400;    // bump to ~30 days
const PERSISTENT_LIFETIME_THRESHOLD: u32 = 518_400; // ~30 days
const PERSISTENT_BUMP_AMOUNT: u32       = 3_110_400; // bump to ~180 days

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    SxlmToken,
    NativeToken,
    /// XLM handed out to strategies. Always 0 until the Phase 2 registry lands,
    /// but the term exists now so `total_assets()` never has to be redefined.
    DeployedToStrategies,
    /// XLM owed to withdrawals whose shares are already burned but whose payout
    /// has not happened yet. Subtracted from assets so the exchange rate does
    /// not rise for remaining holders during the cooldown window.
    PendingWithdrawals,
    CooldownPeriod,
    WithdrawalQueue,
    WithdrawalCounter,
    Initialized,
    Paused,
    Treasury,
    TreasuryBalance,
    /// One-shot marker for the v2 storage migration.
    MigratedV2,
    /// Governance contract, the only caller allowed to change parameters.
    Governance,
    /// Protocol fee, storage-backed so governance can move it.
    ProtocolFeeBps,
    /// Fee charged on withdrawal, kept by the vault rather than paid out.
    WithdrawalFeeBps,
    /// Fee charged on a flash loan, in basis points.
    FlashFeeBps,
    /// Set while a flash loan is outstanding, to block reentry.
    FlashLoanActive,
    /// One open withdrawal request, stored on its own so the cost of any call
    /// is independent of how many requests exist. Removed when claimed.
    Withdrawal(u64),
    /// Ids of an account's open withdrawal requests.
    UserWithdrawals(Address),
}

#[derive(Clone)]
#[contracttype]
pub struct WithdrawalRequest {
    pub id: u64,
    pub user: Address,
    pub xlm_amount: i128,
    pub unlock_ledger: u32,
    pub claimed: bool,
}

// --- TTL helpers ---

fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

fn extend_queue(env: &Env) {
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::WithdrawalQueue, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

// --- Storage helpers ---

fn read_i128(env: &Env, key: &DataKey) -> i128 {
    env.storage().instance().get(key).unwrap_or(0)
}

fn write_i128(env: &Env, key: &DataKey, val: i128) {
    env.storage().instance().set(key, &val);
}

fn read_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

fn read_sxlm_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::SxlmToken).unwrap()
}

fn read_native_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::NativeToken).unwrap()
}

fn read_withdrawal_fee_bps(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::WithdrawalFeeBps)
        .unwrap_or(DEFAULT_WITHDRAWAL_FEE_BPS)
}

fn read_flash_fee_bps(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::FlashFeeBps)
        .unwrap_or(DEFAULT_FLASH_FEE_BPS)
}

/// Refuse anything that changes share supply or vault assets while a flash loan
/// is outstanding. Without this, a borrower could "repay" by depositing the
/// borrowed XLM, restoring the balance while minting themselves shares.
fn require_no_flash_loan(env: &Env) {
    if env.storage().instance().get(&DataKey::FlashLoanActive).unwrap_or(false) {
        panic!("reentrant call during flash loan");
    }
}

fn read_protocol_fee_bps(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::ProtocolFeeBps)
        .unwrap_or(DEFAULT_PROTOCOL_FEE_BPS)
}

/// Authorise a parameter change. Governance holds this power once configured;
/// until then the admin does, so a contract cannot be left with no way to be
/// configured at all.
fn require_param_authority(env: &Env) {
    match env.storage().instance().get::<DataKey, Address>(&DataKey::Governance) {
        Some(gov) => gov.require_auth(),
        None => read_admin(env).require_auth(),
    }
}

fn read_cooldown(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::CooldownPeriod)
        .unwrap_or(17280u32) // ~24 hours at 5s/ledger
}

fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

fn require_not_paused(env: &Env) {
    if is_paused(env) {
        panic!("protocol is paused");
    }
}

fn next_withdrawal_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::WithdrawalCounter)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::WithdrawalCounter, &(id + 1));
    id
}

// --- Withdrawal storage ---
//
// Version 3 keeps each open request in its own persistent entry and an index
// of open ids per account. Earlier versions kept every request ever made in
// one map under `WithdrawalQueue`; that entry only grew, and every call loaded
// all of it, so withdrawals would stop working once it passed the entry size
// limit. The legacy map is read as a fallback and drained by
// `migrate_withdrawals`; nothing writes to it any more.

fn legacy_queue(env: &Env) -> Option<Map<u64, WithdrawalRequest>> {
    let queue: Option<Map<u64, WithdrawalRequest>> =
        env.storage().persistent().get(&DataKey::WithdrawalQueue);
    if queue.is_some() {
        extend_queue(env);
    }
    queue
}

fn set_legacy_queue(env: &Env, queue: &Map<u64, WithdrawalRequest>) {
    if queue.is_empty() {
        env.storage().persistent().remove(&DataKey::WithdrawalQueue);
    } else {
        env.storage().persistent().set(&DataKey::WithdrawalQueue, queue);
        extend_queue(env);
    }
}

fn read_withdrawal_entry(env: &Env, id: u64) -> Option<WithdrawalRequest> {
    let key = DataKey::Withdrawal(id);
    let request: Option<WithdrawalRequest> = env.storage().persistent().get(&key);
    if request.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
    }
    request
}

fn write_withdrawal_entry(env: &Env, request: &WithdrawalRequest) {
    let key = DataKey::Withdrawal(request.id);
    env.storage().persistent().set(&key, request);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

fn read_user_index(env: &Env, user: &Address) -> Vec<u64> {
    let key = DataKey::UserWithdrawals(user.clone());
    let ids: Option<Vec<u64>> = env.storage().persistent().get(&key);
    match ids {
        Some(ids) => {
            env.storage()
                .persistent()
                .extend_ttl(&key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
            ids
        }
        None => Vec::new(env),
    }
}

fn write_user_index(env: &Env, user: &Address, ids: &Vec<u64>) {
    let key = DataKey::UserWithdrawals(user.clone());
    if ids.is_empty() {
        env.storage().persistent().remove(&key);
    } else {
        env.storage().persistent().set(&key, ids);
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
    }
}

fn index_add(env: &Env, user: &Address, id: u64) {
    let mut ids = read_user_index(env, user);
    if ids.len() >= MAX_OPEN_WITHDRAWALS_PER_USER {
        panic!("too many open withdrawals; claim one first");
    }
    ids.push_back(id);
    write_user_index(env, user, &ids);
}

fn index_remove(env: &Env, user: &Address, id: u64) {
    let ids = read_user_index(env, user);
    let mut kept = Vec::new(env);
    for existing in ids.iter() {
        if existing != id {
            kept.push_back(existing);
        }
    }
    write_user_index(env, user, &kept);
}

/// Store a new open request.
fn open_withdrawal(env: &Env, request: &WithdrawalRequest) {
    write_withdrawal_entry(env, request);
    index_add(env, &request.user, request.id);
}

/// Find a request in current storage, then in the legacy map.
fn find_withdrawal(env: &Env, id: u64) -> Option<WithdrawalRequest> {
    if let Some(request) = read_withdrawal_entry(env, id) {
        return Some(request);
    }
    legacy_queue(env).and_then(|queue| queue.get(id))
}

/// Remove a request that is being paid out, wherever it is stored.
fn close_withdrawal(env: &Env, request: &WithdrawalRequest) {
    let key = DataKey::Withdrawal(request.id);
    if env.storage().persistent().has(&key) {
        env.storage().persistent().remove(&key);
        index_remove(env, &request.user, request.id);
        return;
    }
    if let Some(mut queue) = legacy_queue(env) {
        queue.remove(request.id);
        set_legacy_queue(env, &queue);
    }
}

// ==========================================================
// Accounting
//
// There is deliberately no stored "total XLM" numerator. Every figure below is
// derived from balances the contract can actually pay out. A stored numerator
// is what allowed the exchange rate to drift away from real holdings; deriving
// it removes the possibility rather than one instance of it.
// ==========================================================

/// XLM sitting in the contract right now, including amounts that are already
/// spoken for (queued withdrawals, accrued protocol fees).
fn idle_balance(env: &Env) -> i128 {
    let native = read_native_token(env);
    token::Client::new(env, &native).balance(&env.current_contract_address())
}

/// XLM backing sXLM shares: everything the contract holds or has deployed,
/// less every claim on it that is not a share claim.
fn total_assets(env: &Env) -> i128 {
    let assets = idle_balance(env)
        + read_i128(env, &DataKey::DeployedToStrategies)
        - read_i128(env, &DataKey::PendingWithdrawals)
        - read_i128(env, &DataKey::TreasuryBalance);
    if assets < 0 {
        0
    } else {
        assets
    }
}

/// XLM free to pay out this instant, net of prior claims.
fn unencumbered_balance(env: &Env) -> i128 {
    idle_balance(env)
        - read_i128(env, &DataKey::PendingWithdrawals)
        - read_i128(env, &DataKey::TreasuryBalance)
}

/// Share supply, read from the token contract rather than mirrored locally.
/// A local mirror is the same bug class as a stored asset numerator.
fn total_shares(env: &Env) -> i128 {
    let sxlm = read_sxlm_token(env);
    SxlmTokenClient::new(env, &sxlm).total_supply()
}

#[contract]
pub struct VaultContract;

#[contractimpl]
impl VaultContract {
    /// Initialize the staking contract.
    pub fn initialize(
        env: Env,
        admin: Address,
        sxlm_token: Address,
        native_token: Address,
        cooldown_period: u32,
    ) {
        if env.storage().instance().has(&DataKey::Initialized) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::SxlmToken, &sxlm_token);
        env.storage().instance().set(&DataKey::NativeToken, &native_token);
        env.storage().instance().set(&DataKey::CooldownPeriod, &cooldown_period);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::Treasury, &admin);
        env.storage().instance().set(&DataKey::MigratedV2, &true);
        write_i128(&env, &DataKey::DeployedToStrategies, 0);
        write_i128(&env, &DataKey::PendingWithdrawals, 0);
        write_i128(&env, &DataKey::TreasuryBalance, 0);
        extend_instance(&env);
    }

    /// Upgrade the contract WASM. Only callable by admin.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin = read_admin(&env);
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// One-shot storage migration for a contract deployed before derived
    /// accounting.
    ///
    /// Reconstructs `PendingWithdrawals` by summing unclaimed queue entries.
    /// Required once on any contract upgraded from a build that did not record
    /// the liability, or `total_assets()` counts XLM already owed to the queue.
    ///
    /// Legacy `TotalXlmStaked`, `TotalSxlmSupply` and `LiquidityBuffer` entries
    /// are left orphaned; nothing reads them.
    pub fn migrate_v2(env: Env) {
        let admin = read_admin(&env);
        admin.require_auth();
        if env.storage().instance().has(&DataKey::MigratedV2) {
            panic!("already migrated");
        }
        extend_instance(&env);

        let mut pending: i128 = 0;
        if let Some(queue) = legacy_queue(&env) {
            for (_, request) in queue.iter() {
                if !request.claimed {
                    pending += request.xlm_amount;
                }
            }
        }

        write_i128(&env, &DataKey::PendingWithdrawals, pending);
        write_i128(&env, &DataKey::DeployedToStrategies, 0);
        env.storage().instance().set(&DataKey::MigratedV2, &true);

        env.events().publish(
            (soroban_sdk::symbol_short!("migrated"),),
            (pending, idle_balance(&env), total_shares(&env)),
        );
    }

    /// Move requests from the legacy single-map queue into per-request storage.
    ///
    /// Moves up to `limit` entries per call and returns how many remain, so a
    /// large legacy map can be drained across several transactions. Unclaimed
    /// requests keep their id, amount and unlock ledger; claimed ones are
    /// dropped. Callable by anyone: it changes where a request is stored, never
    /// what it is worth or who can claim it.
    pub fn migrate_withdrawals(env: Env, limit: u32) -> u32 {
        extend_instance(&env);
        let mut queue = match legacy_queue(&env) {
            Some(q) => q,
            None => return 0,
        };

        let mut moved: u32 = 0;
        let mut ids = Vec::new(&env);
        for (id, _) in queue.iter() {
            if moved >= limit {
                break;
            }
            ids.push_back(id);
            moved += 1;
        }

        for id in ids.iter() {
            let request = queue.get(id).unwrap();
            if !request.claimed {
                open_withdrawal(&env, &request);
            }
            queue.remove(id);
        }

        let remaining = queue.len();
        set_legacy_queue(&env, &queue);

        env.events().publish(
            (soroban_sdk::symbol_short!("wd_migr"),),
            (moved, remaining),
        );
        remaining
    }

    /// Bump instance TTL — can be called by anyone to keep the contract alive.
    pub fn bump_instance(env: Env) {
        extend_instance(&env);
    }

    // ==========================================================
    // Core staking functions
    // ==========================================================

    /// Deposit XLM and receive sXLM tokens.
    pub fn deposit(env: Env, user: Address, xlm_amount: i128) {
        require_no_flash_loan(&env);
        require_not_paused(&env);
        user.require_auth();
        if xlm_amount <= 0 {
            panic!("deposit amount must be positive");
        }
        extend_instance(&env);

        // Snapshot before the transfer: total_assets() reads the live balance,
        // so taking it afterwards would price the deposit against itself.
        let assets_before = total_assets(&env);
        let supply_before = total_shares(&env);

        let native_token_addr = read_native_token(&env);
        let xlm_client = token::Client::new(&env, &native_token_addr);
        xlm_client.transfer(&user, &env.current_contract_address(), &xlm_amount);

        let sxlm_token = read_sxlm_token(&env);
        let sxlm_client = SxlmTokenClient::new(&env, &sxlm_token);

        if supply_before == 0 {
            // Bootstrap. MINIMUM_LIQUIDITY shares are minted to the contract and
            // never redeemed, so the vault can never be emptied back to a state
            // where the next depositor sets the price.
            if xlm_amount <= MINIMUM_LIQUIDITY {
                panic!("initial deposit below minimum liquidity");
            }
            sxlm_client.mint(&env.current_contract_address(), &MINIMUM_LIQUIDITY);
            sxlm_client.mint(&user, &(xlm_amount - MINIMUM_LIQUIDITY));

            env.events().publish(
                (soroban_sdk::symbol_short!("deposit"),),
                (user, xlm_amount, xlm_amount - MINIMUM_LIQUIDITY),
            );
            return;
        }

        if assets_before <= 0 {
            // Shares exist but nothing backs them. Minting against this would
            // price the deposit arbitrarily; refuse instead.
            panic!("vault has no assets");
        }

        let sxlm_to_mint = xlm_amount * supply_before / assets_before;
        if sxlm_to_mint <= 0 {
            panic!("mint amount too small");
        }
        sxlm_client.mint(&user, &sxlm_to_mint);

        env.events().publish(
            (soroban_sdk::symbol_short!("deposit"),),
            (user, xlm_amount, sxlm_to_mint),
        );
    }

    /// Request withdrawal: burns sXLM and returns XLM.
    pub fn request_withdrawal(env: Env, user: Address, sxlm_amount: i128) {
        require_no_flash_loan(&env);
        require_not_paused(&env);
        user.require_auth();
        if sxlm_amount <= 0 {
            panic!("withdrawal amount must be positive");
        }
        extend_instance(&env);

        let assets = total_assets(&env);
        let supply = total_shares(&env);

        if supply == 0 {
            panic!("no sXLM in circulation");
        }

        let gross = sxlm_amount * assets / supply;
        // The fee is simply not paid out, so it stays as vault assets and lifts
        // the rate for everyone who did not leave.
        let fee = gross * read_withdrawal_fee_bps(&env) / BPS_DENOMINATOR;
        let xlm_to_return = gross - fee;
        if xlm_to_return <= 0 {
            panic!("return amount too small");
        }

        let sxlm_token = read_sxlm_token(&env);
        let sxlm_client = SxlmTokenClient::new(&env, &sxlm_token);
        sxlm_client.burn(&user, &sxlm_amount);

        if unencumbered_balance(&env) >= xlm_to_return {
            let native_token_addr = read_native_token(&env);
            let xlm_client = token::Client::new(&env, &native_token_addr);
            xlm_client.transfer(&env.current_contract_address(), &user, &xlm_to_return);

            env.events().publish(
                (soroban_sdk::symbol_short!("instant"),),
                (user, xlm_to_return),
            );
        } else {
            // Shares are gone but the XLM has not left yet. Record the debt in
            // the same breath as burning the shares, or the exchange rate rises
            // for everyone still holding until the claim lands.
            let pending = read_i128(&env, &DataKey::PendingWithdrawals);
            write_i128(&env, &DataKey::PendingWithdrawals, pending + xlm_to_return);

            let cooldown = read_cooldown(&env);
            let unlock_ledger = env.ledger().sequence() + cooldown;
            let id = next_withdrawal_id(&env);

            let request = WithdrawalRequest {
                id,
                user: user.clone(),
                xlm_amount: xlm_to_return,
                unlock_ledger,
                claimed: false,
            };
            open_withdrawal(&env, &request);

            env.events().publish(
                (soroban_sdk::symbol_short!("delayed"),),
                (user, xlm_to_return, id, unlock_ledger),
            );
        }
    }

    /// Claim a delayed withdrawal after cooldown has expired.
    pub fn claim_withdrawal(env: Env, user: Address, withdrawal_id: u64) {
        require_no_flash_loan(&env);
        user.require_auth();
        extend_instance(&env);

        let request = find_withdrawal(&env, withdrawal_id).expect("withdrawal not found");

        if request.user != user {
            panic!("not your withdrawal");
        }
        if request.claimed {
            panic!("already claimed");
        }
        if env.ledger().sequence() < request.unlock_ledger {
            panic!("cooldown not expired");
        }

        // The request is removed rather than flagged, so storage tracks open
        // requests only and a second claim finds nothing to pay.
        close_withdrawal(&env, &request);

        // Retire the liability as the XLM leaves, so the two move together.
        let pending = read_i128(&env, &DataKey::PendingWithdrawals);
        let remaining = pending - request.xlm_amount;
        write_i128(&env, &DataKey::PendingWithdrawals, if remaining < 0 { 0 } else { remaining });

        let native_token_addr = read_native_token(&env);
        let xlm_client = token::Client::new(&env, &native_token_addr);
        xlm_client.transfer(&env.current_contract_address(), &user, &request.xlm_amount);

        env.events().publish(
            (soroban_sdk::symbol_short!("claimed"),),
            (user, request.xlm_amount, withdrawal_id),
        );
    }

    // ==========================================================
    // Reward & Fee functions
    // ==========================================================

    /// Contribute realised yield to the vault.
    ///
    /// The XLM is transferred in. There is no counter to increment: the deposit
    /// raises the contract balance, `total_assets()` reads that balance, and the
    /// exchange rate follows. The protocol fee is booked as a liability so it is
    /// excluded from the assets backing shares until it is withdrawn.
    pub fn add_rewards(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic!("reward amount must be positive");
        }
        extend_instance(&env);

        let native_token_addr = read_native_token(&env);
        let xlm_client = token::Client::new(&env, &native_token_addr);
        xlm_client.transfer(&from, &env.current_contract_address(), &amount);

        let fee = amount * read_protocol_fee_bps(&env) / BPS_DENOMINATOR;
        let net_reward = amount - fee;

        let treasury_bal = read_i128(&env, &DataKey::TreasuryBalance);
        write_i128(&env, &DataKey::TreasuryBalance, treasury_bal + fee);

        env.events().publish(
            (soroban_sdk::symbol_short!("rewards"),),
            (amount, net_reward, fee),
        );
    }

    /// Withdraw protocol fees to the treasury address (the admin unless
    /// `set_treasury` named another). If amount > 0, withdraw that specific
    /// amount; if 0, withdraw all.
    pub fn withdraw_fees(env: Env, amount: i128) {
        let admin = read_admin(&env);
        admin.require_auth();
        extend_instance(&env);

        let treasury_bal = read_i128(&env, &DataKey::TreasuryBalance);

        let withdraw_amount = if amount <= 0 {
            treasury_bal
        } else {
            amount
        };

        if withdraw_amount <= 0 {
            panic!("no fees to withdraw");
        }
        if withdraw_amount > treasury_bal {
            panic!("insufficient treasury balance");
        }
        // Fees are only real if the XLM is actually here and not already owed to
        // the withdrawal queue.
        if withdraw_amount > idle_balance(&env) - read_i128(&env, &DataKey::PendingWithdrawals) {
            panic!("insufficient unencumbered balance");
        }

        let treasury: Address = env
            .storage()
            .instance()
            .get(&DataKey::Treasury)
            .unwrap_or(admin);

        // Book the withdrawal before the transfer, so the liability and the
        // XLM leave together.
        write_i128(&env, &DataKey::TreasuryBalance, treasury_bal - withdraw_amount);

        let native_token_addr = read_native_token(&env);
        let xlm_client = token::Client::new(&env, &native_token_addr);
        xlm_client.transfer(&env.current_contract_address(), &treasury, &withdraw_amount);

        env.events().publish(
            (soroban_sdk::symbol_short!("fee_out"),),
            (treasury, withdraw_amount),
        );
    }

    /// Where `withdraw_fees` pays protocol revenue.
    pub fn set_treasury(env: Env, treasury: Address) {
        let admin = read_admin(&env);
        admin.require_auth();
        extend_instance(&env);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.events().publish((soroban_sdk::symbol_short!("treasury"),), treasury);
    }

    pub fn treasury(env: Env) -> Address {
        extend_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::Treasury)
            .unwrap_or(read_admin(&env))
    }

    // ==========================================================
    // Liquidity
    // ==========================================================

    /// Lend idle XLM for the length of one transaction.
    ///
    /// The receiver is called once and must return the amount plus the fee
    /// before this function returns. There is no credit risk: if the balance is
    /// not restored the assertion fails and the whole transaction reverts, loan
    /// included. The fee stays in the vault, so it raises the exchange rate.
    ///
    /// Deposits, withdrawals and claims are blocked for the duration. Without
    /// that, a borrower could satisfy the balance check by depositing the
    /// borrowed XLM and mint themselves shares out of the loan.
    pub fn flash_loan(env: Env, receiver: Address, amount: i128) {
        require_not_paused(&env);
        require_no_flash_loan(&env);
        if amount <= 0 {
            panic!("loan amount must be positive");
        }
        extend_instance(&env);

        // Lend only what is not already spoken for by the withdrawal queue or
        // accrued fees.
        let available = unencumbered_balance(&env);
        if amount > available {
            panic!("insufficient unencumbered balance");
        }

        let fee = amount * read_flash_fee_bps(&env) / BPS_DENOMINATOR;
        let native_token_addr = read_native_token(&env);
        let xlm_client = token::Client::new(&env, &native_token_addr);
        let balance_before = xlm_client.balance(&env.current_contract_address());

        env.storage().instance().set(&DataKey::FlashLoanActive, &true);
        xlm_client.transfer(&env.current_contract_address(), &receiver, &amount);

        FlashLoanReceiverClient::new(&env, &receiver).on_flash_loan(&amount, &fee);

        let balance_after = xlm_client.balance(&env.current_contract_address());
        env.storage().instance().set(&DataKey::FlashLoanActive, &false);

        if balance_after < balance_before + fee {
            panic!("flash loan not repaid with fee");
        }

        env.events().publish(
            (soroban_sdk::symbol_short!("flash"),),
            (receiver, amount, fee),
        );
    }

    /// Donate XLM to the vault with no shares minted in return.
    ///
    /// No separate buffer counter: the donated XLM is part of the balance, so it
    /// backs shares like any other asset.
    pub fn add_liquidity(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic!("liquidity amount must be positive");
        }
        extend_instance(&env);

        let native_token_addr = read_native_token(&env);
        let xlm_client = token::Client::new(&env, &native_token_addr);
        xlm_client.transfer(&from, &env.current_contract_address(), &amount);

        env.events().publish(
            (soroban_sdk::symbol_short!("liq_add"),),
            (from, amount),
        );
    }

    /// Transfer the admin role. Both the current and the new admin must sign,
    /// so a typo cannot hand the contract to an address nobody controls.
    pub fn set_admin(env: Env, new_admin: Address) {
        let admin = read_admin(&env);
        admin.require_auth();
        new_admin.require_auth();
        extend_instance(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events().publish((soroban_sdk::symbol_short!("admin"),), (admin, new_admin));
    }

    /// Hand parameter control to the governance contract, once.
    ///
    /// This is the step that makes a passed proposal actually do something. It
    /// is deliberately separate from deploying the code: handing over control
    /// of a live contract is a decision, not a side effect of an upgrade.
    pub fn set_governance(env: Env, governance: Address) {
        let admin = read_admin(&env);
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Governance) {
            panic!("governance already set");
        }
        extend_instance(&env);
        env.storage().instance().set(&DataKey::Governance, &governance);
        env.events().publish((soroban_sdk::symbol_short!("gov_set"),), governance);
    }

    /// Apply a governance-approved parameter change.
    ///
    /// Only the configured governance contract may call this, and only these
    /// keys exist — an approved proposal naming anything else does nothing
    /// rather than silently succeeding.
    pub fn set_param(env: Env, key: Symbol, value: i128) {
        require_param_authority(&env);
        extend_instance(&env);

        if key == soroban_sdk::symbol_short!("cooldown") {
            assert!(value >= 0 && value <= u32::MAX as i128, "cooldown out of range");
            env.storage().instance().set(&DataKey::CooldownPeriod, &(value as u32));
        } else if key == soroban_sdk::symbol_short!("wd_fee") {
            assert!(value >= 0 && value <= 500, "withdrawal fee out of range");
            write_i128(&env, &DataKey::WithdrawalFeeBps, value);
        } else if key == soroban_sdk::symbol_short!("flash_fee") {
            assert!(value >= 0 && value <= 500, "flash fee out of range");
            write_i128(&env, &DataKey::FlashFeeBps, value);
        } else if key == soroban_sdk::symbol_short!("fee_bps") {
            assert!(value >= 0 && value <= BPS_DENOMINATOR, "fee out of range");
            write_i128(&env, &DataKey::ProtocolFeeBps, value);
        } else {
            panic!("unknown parameter");
        }

        env.events().publish((soroban_sdk::symbol_short!("param"),), (key, value));
    }

    /// Same power as `set_param("cooldown", ..)`: governance once configured,
    /// the admin until then. Kept for existing callers.
    pub fn set_cooldown_period(env: Env, new_cooldown: u32) {
        require_param_authority(&env);
        extend_instance(&env);
        env.storage().instance().set(&DataKey::CooldownPeriod, &new_cooldown);
        env.events().publish((soroban_sdk::symbol_short!("cd_upd"),), new_cooldown);
    }

    // ==========================================================
    // Emergency pause
    // ==========================================================

    pub fn pause(env: Env) {
        let admin = read_admin(&env);
        admin.require_auth();
        extend_instance(&env);
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish((soroban_sdk::symbol_short!("paused"),), ());
    }

    pub fn unpause(env: Env) {
        let admin = read_admin(&env);
        admin.require_auth();
        extend_instance(&env);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish((soroban_sdk::symbol_short!("unpaused"),), ());
    }

    // ==========================================================
    // View functions
    // ==========================================================

    pub fn get_exchange_rate(env: Env) -> i128 {
        extend_instance(&env);
        let assets = total_assets(&env);
        let supply = total_shares(&env);
        if supply == 0 {
            RATE_PRECISION
        } else {
            assets * RATE_PRECISION / supply
        }
    }

    /// XLM backing sXLM shares.
    pub fn total_assets(env: Env) -> i128 {
        extend_instance(&env);
        total_assets(&env)
    }

    /// Retained for client compatibility; identical to `total_assets`.
    pub fn total_xlm_staked(env: Env) -> i128 {
        extend_instance(&env);
        total_assets(&env)
    }

    pub fn total_sxlm_supply(env: Env) -> i128 {
        extend_instance(&env);
        total_shares(&env)
    }

    /// Raw XLM held by the contract, including encumbered amounts.
    pub fn idle_balance(env: Env) -> i128 {
        extend_instance(&env);
        idle_balance(&env)
    }

    /// XLM free to pay out right now.
    pub fn liquidity_buffer(env: Env) -> i128 {
        extend_instance(&env);
        let free = unencumbered_balance(&env);
        if free < 0 {
            0
        } else {
            free
        }
    }

    /// XLM owed to withdrawals whose shares are already burned.
    pub fn pending_withdrawals(env: Env) -> i128 {
        extend_instance(&env);
        read_i128(&env, &DataKey::PendingWithdrawals)
    }

    pub fn deployed_to_strategies(env: Env) -> i128 {
        extend_instance(&env);
        read_i128(&env, &DataKey::DeployedToStrategies)
    }

    pub fn treasury_balance(env: Env) -> i128 {
        extend_instance(&env);
        read_i128(&env, &DataKey::TreasuryBalance)
    }

    pub fn is_paused(env: Env) -> bool {
        extend_instance(&env);
        is_paused(&env)
    }

    pub fn withdrawal_fee_bps(env: Env) -> i128 {
        extend_instance(&env);
        read_withdrawal_fee_bps(&env)
    }

    pub fn flash_fee_bps(env: Env) -> i128 {
        extend_instance(&env);
        read_flash_fee_bps(&env)
    }

    pub fn protocol_fee_bps(env: Env) -> i128 {
        extend_instance(&env);
        read_protocol_fee_bps(&env)
    }

    pub fn governance(env: Env) -> Address {
        extend_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::Governance)
            .expect("governance not configured")
    }

    pub fn get_cooldown_period(env: Env) -> u32 {
        extend_instance(&env);
        read_cooldown(&env)
    }

    /// An open withdrawal request. Claimed requests are removed, so this
    /// panics with "withdrawal not found" once a request has been paid.
    pub fn get_withdrawal(env: Env, withdrawal_id: u64) -> WithdrawalRequest {
        extend_instance(&env);
        find_withdrawal(&env, withdrawal_id).expect("withdrawal not found")
    }

    /// Every open withdrawal request for an account, oldest first.
    /// Requests still in the legacy map appear once `migrate_withdrawals` has
    /// moved them.
    pub fn get_user_withdrawals(env: Env, user: Address) -> Vec<WithdrawalRequest> {
        extend_instance(&env);
        let mut out = Vec::new(&env);
        for id in read_user_index(&env, &user).iter() {
            if let Some(request) = read_withdrawal_entry(&env, id) {
                out.push_back(request);
            }
        }
        out
    }

    /// Withdrawal ids issued so far. Ids run from 0 to this value minus one.
    pub fn withdrawal_count(env: Env) -> u64 {
        extend_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::WithdrawalCounter)
            .unwrap_or(0)
    }

    /// Entries still in the legacy single-map queue. Zero once migrated.
    pub fn legacy_queue_len(env: Env) -> u32 {
        extend_instance(&env);
        legacy_queue(&env).map(|q| q.len()).unwrap_or(0)
    }

    pub fn version(_env: Env) -> u32 {
        CONTRACT_VERSION
    }

    pub fn admin(env: Env) -> Address {
        extend_instance(&env);
        read_admin(&env)
    }
}

use soroban_sdk::contractclient;

/// Implemented by anything that takes a flash loan. The callback must return
/// `amount + fee` to the vault before it returns.
#[contractclient(name = "FlashLoanReceiverClient")]
pub trait FlashLoanReceiver {
    fn on_flash_loan(env: Env, amount: i128, fee: i128);
}

#[contractclient(name = "SxlmTokenClient")]
pub trait SxlmTokenInterface {
    fn mint(env: Env, to: Address, amount: i128);
    fn burn(env: Env, from: Address, amount: i128);
    fn balance(env: Env, id: Address) -> i128;
    fn total_supply(env: Env) -> i128;
}

#[cfg(test)]
mod test {
    use super::*;
    extern crate std;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Ledger;
    use soroban_sdk::{symbol_short, Env};

    // ------------------------------------------------------------------
    // Minimal sXLM stand-in. The real token lives in its own crate; this
    // implements just the four entrypoints the vault calls, so share supply
    // behaves like a real external token rather than a local counter.
    // ------------------------------------------------------------------

    #[contract]
    pub struct MockSxlm;

    #[contractimpl]
    impl MockSxlm {
        pub fn mint(env: Env, to: Address, amount: i128) {
            let mut balances: Map<Address, i128> = env
                .storage()
                .instance()
                .get(&symbol_short!("BAL"))
                .unwrap_or(Map::new(&env));
            let current = balances.get(to.clone()).unwrap_or(0);
            balances.set(to, current + amount);
            env.storage().instance().set(&symbol_short!("BAL"), &balances);

            let supply: i128 = env
                .storage()
                .instance()
                .get(&symbol_short!("SUP"))
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&symbol_short!("SUP"), &(supply + amount));
        }

        pub fn burn(env: Env, from: Address, amount: i128) {
            let mut balances: Map<Address, i128> = env
                .storage()
                .instance()
                .get(&symbol_short!("BAL"))
                .unwrap_or(Map::new(&env));
            let current = balances.get(from.clone()).unwrap_or(0);
            if current < amount {
                panic!("insufficient sxlm balance");
            }
            balances.set(from, current - amount);
            env.storage().instance().set(&symbol_short!("BAL"), &balances);

            let supply: i128 = env
                .storage()
                .instance()
                .get(&symbol_short!("SUP"))
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&symbol_short!("SUP"), &(supply - amount));
        }

        pub fn balance(env: Env, id: Address) -> i128 {
            let balances: Map<Address, i128> = env
                .storage()
                .instance()
                .get(&symbol_short!("BAL"))
                .unwrap_or(Map::new(&env));
            balances.get(id).unwrap_or(0)
        }

        pub fn total_supply(env: Env) -> i128 {
            env.storage()
                .instance()
                .get(&symbol_short!("SUP"))
                .unwrap_or(0)
        }
    }

    mod honest {
        use super::*;
        /// Returns the loan plus the fee, as a borrower should.
        #[contract]
        pub struct HonestBorrower;

        #[contractimpl]
        impl HonestBorrower {
            pub fn init(env: Env, token: Address, vault: Address) {
                env.storage().instance().set(&symbol_short!("TOK"), &token);
                env.storage().instance().set(&symbol_short!("VLT"), &vault);
            }
            pub fn on_flash_loan(env: Env, amount: i128, fee: i128) {
                let token: Address =
                    env.storage().instance().get(&symbol_short!("TOK")).unwrap();
                let vault: Address =
                    env.storage().instance().get(&symbol_short!("VLT")).unwrap();
                token::Client::new(&env, &token).transfer(
                    &env.current_contract_address(),
                    &vault,
                    &(amount + fee),
                );
            }
        }
    }

    mod deadbeat {
        use super::*;
        /// Keeps the money.
        #[contract]
        pub struct Deadbeat;

        #[contractimpl]
        impl Deadbeat {
            pub fn on_flash_loan(_env: Env, _amount: i128, _fee: i128) {}
        }
    }

    mod attacker {
        use super::*;
        /// Tries to settle the loan by depositing it back for shares.
        #[contract]
        pub struct DepositAttacker;

        #[contractimpl]
        impl DepositAttacker {
            pub fn init(env: Env, vault: Address) {
                env.storage().instance().set(&symbol_short!("VLT"), &vault);
            }
            pub fn on_flash_loan(env: Env, amount: i128, _fee: i128) {
                let vault: Address =
                    env.storage().instance().get(&symbol_short!("VLT")).unwrap();
                VaultContractClient::new(&env, &vault)
                    .deposit(&env.current_contract_address(), &amount);
            }
        }
    }

    use attacker::{DepositAttacker, DepositAttackerClient};
    use deadbeat::Deadbeat;
    use honest::{HonestBorrower, HonestBorrowerClient};

    struct Fixture<'a> {
        env: Env,
        vault: VaultContractClient<'a>,
        vault_id: Address,
        sxlm: MockSxlmClient<'a>,
        xlm: token::Client<'a>,
        xlm_admin: token::StellarAssetClient<'a>,
        admin: Address,
    }

    fn setup(env: &Env) -> Fixture<'_> {
        env.mock_all_auths();

        let admin = Address::generate(env);
        let native_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let sxlm_id = env.register_contract(None, MockSxlm);
        let vault_id = env.register_contract(None, VaultContract);

        let vault = VaultContractClient::new(env, &vault_id);
        vault.initialize(&admin, &sxlm_id, &native_id, &17280u32);

        Fixture {
            env: env.clone(),
            vault,
            vault_id,
            sxlm: MockSxlmClient::new(env, &sxlm_id),
            xlm: token::Client::new(env, &native_id),
            xlm_admin: token::StellarAssetClient::new(env, &native_id),
            admin,
        }
    }

    fn funded_user(f: &Fixture, amount: i128) -> Address {
        let user = Address::generate(&f.env);
        f.xlm_admin.mint(&user, &amount);
        user
    }

    // ------------------------------------------------------------------
    // Baseline
    // ------------------------------------------------------------------

    #[test]
    fn empty_vault_reports_unit_rate() {
        let env = Env::default();
        let f = setup(&env);
        assert_eq!(f.vault.get_exchange_rate(), RATE_PRECISION);
        assert_eq!(f.vault.total_assets(), 0);
        assert_eq!(f.vault.total_sxlm_supply(), 0);
        assert_eq!(f.vault.pending_withdrawals(), 0);
    }

    #[test]
    fn deposit_then_withdraw_round_trips() {
        let env = Env::default();
        let f = setup(&env);
        let user = funded_user(&f, 100_0000000);

        f.vault.deposit(&user, &100_0000000);
        let shares = f.sxlm.balance(&user);
        assert_eq!(shares, 100_0000000 - MINIMUM_LIQUIDITY);

        f.vault.request_withdrawal(&user, &shares);
        // Paid instantly, less the withdrawal fee left for the dead shares.
        assert_eq!(f.sxlm.balance(&user), 0);
        assert!(f.xlm.balance(&user) >= 99_8000000);
    }

    // ------------------------------------------------------------------
    // Dead shares
    // ------------------------------------------------------------------

    #[test]
    fn first_deposit_locks_minimum_liquidity() {
        let env = Env::default();
        let f = setup(&env);
        let user = funded_user(&f, 10_0000000);

        f.vault.deposit(&user, &10_0000000);

        assert_eq!(f.sxlm.balance(&f.vault_id), MINIMUM_LIQUIDITY);
        assert_eq!(f.sxlm.balance(&user), 10_0000000 - MINIMUM_LIQUIDITY);
        assert_eq!(f.vault.total_sxlm_supply(), 10_0000000);
    }

    #[test]
    #[should_panic(expected = "initial deposit below minimum liquidity")]
    fn dust_first_deposit_is_refused() {
        let env = Env::default();
        let f = setup(&env);
        let attacker = funded_user(&f, 10_0000000);
        f.vault.deposit(&attacker, &1);
    }

    #[test]
    fn donation_after_dust_deposit_cannot_squeeze_out_later_depositors() {
        let env = Env::default();
        let f = setup(&env);

        // Smallest deposit the vault will now accept.
        let attacker = funded_user(&f, 1_000_0000000);
        f.vault.deposit(&attacker, &(MINIMUM_LIQUIDITY + 1));

        // Classic inflation attack: donate a large amount to move share price.
        f.vault.add_liquidity(&attacker, &100_0000000);

        // A later depositor must still receive shares rather than rounding to nothing.
        let victim = funded_user(&f, 100_0000000);
        f.vault.deposit(&victim, &100_0000000);
        assert!(f.sxlm.balance(&victim) > 0);
    }

    // ------------------------------------------------------------------
    // The bug that is live on mainnet
    // ------------------------------------------------------------------

    #[test]
    fn a_withdrawal_leaves_the_rate_untouched() {
        let env = Env::default();
        let f = setup(&env);

        let alice = funded_user(&f, 100_0000000);
        let bob = funded_user(&f, 100_0000000);
        f.vault.deposit(&alice, &100_0000000);
        f.vault.deposit(&bob, &100_0000000);

        let rate_before = f.vault.get_exchange_rate();
        let alice_shares = f.sxlm.balance(&alice);
        f.vault.request_withdrawal(&alice, &(alice_shares / 2));
        let rate_after = f.vault.get_exchange_rate();

        // A withdrawal may lift the rate by the fee it leaves behind, and must
        // never lower it.
        assert!(rate_after >= rate_before, "a withdrawal lowered the rate");
    }

    #[test]
    fn everything_is_liquid_while_nothing_is_deployed() {
        let env = Env::default();
        let f = setup(&env);
        let alice = funded_user(&f, 100_0000000);
        f.vault.deposit(&alice, &100_0000000);

        // With no strategy allocations the free balance equals the share
        // backing, so no withdrawal can be forced into the queue.
        assert_eq!(f.vault.deployed_to_strategies(), 0);
        assert_eq!(f.vault.total_assets(), f.vault.liquidity_buffer());

        f.vault.request_withdrawal(&alice, &f.sxlm.balance(&alice));
        assert_eq!(f.vault.pending_withdrawals(), 0);
    }

    /// A queued withdrawal's XLM is a liability, not backing. Shares are already
    /// burned, so counting it would appreciate everyone else's.
    #[test]
    fn pending_withdrawals_are_excluded_from_share_backing() {
        let env = Env::default();
        let f = setup(&env);

        let alice = funded_user(&f, 100_0000000);
        f.vault.deposit(&alice, &100_0000000);

        let assets_before = f.vault.total_assets();
        let rate_before = f.vault.get_exchange_rate();

        // Stand in for a queued exit: XLM spoken for, shares already gone.
        let owed: i128 = 10_0000000;
        env.as_contract(&f.vault_id, || {
            write_i128(&env, &DataKey::PendingWithdrawals, owed);
        });

        assert_eq!(f.vault.total_assets(), assets_before - owed);
        assert!(
            f.vault.get_exchange_rate() < rate_before,
            "unpaid exits must not appreciate the remaining shares"
        );
        assert_eq!(f.vault.pending_withdrawals(), owed);
    }

    #[test]
    fn migrate_v2_reconstructs_the_liability_from_the_queue() {
        let env = Env::default();
        let f = setup(&env);

        let alice = funded_user(&f, 100_0000000);
        f.vault.deposit(&alice, &100_0000000);

        // Recreate what the live contract looks like before the upgrade: a
        // queue carrying burned-share obligations, no liability recorded.
        env.as_contract(&f.vault_id, || {
            let mut queue: Map<u64, WithdrawalRequest> = Map::new(&env);
            queue.set(0, WithdrawalRequest {
                id: 0, user: alice.clone(), xlm_amount: 9_848_024,
                unlock_ledger: 1, claimed: false,
            });
            queue.set(1, WithdrawalRequest {
                id: 1, user: alice.clone(), xlm_amount: 9_997_655,
                unlock_ledger: 1, claimed: false,
            });
            queue.set(2, WithdrawalRequest {
                id: 2, user: alice.clone(), xlm_amount: 18_269_206,
                unlock_ledger: 1, claimed: false,
            });
            // Already settled: must not be counted.
            queue.set(3, WithdrawalRequest {
                id: 3, user: alice.clone(), xlm_amount: 10_000_000,
                unlock_ledger: 1, claimed: true,
            });
            set_legacy_queue(&env, &queue);
            env.storage().instance().remove(&DataKey::MigratedV2);
            write_i128(&env, &DataKey::PendingWithdrawals, 0);
        });

        let assets_before = f.vault.total_assets();
        f.vault.migrate_v2();

        // The three live mainnet obligations, to the stroop.
        assert_eq!(f.vault.pending_withdrawals(), 38_114_885);
        assert_eq!(f.vault.total_assets(), assets_before - 38_114_885);
    }

    // ------------------------------------------------------------------
    // Rewards must be funded
    // ------------------------------------------------------------------

    #[test]
    fn add_rewards_moves_real_xlm_and_lifts_the_rate() {
        let env = Env::default();
        let f = setup(&env);

        let user = funded_user(&f, 100_0000000);
        f.vault.deposit(&user, &100_0000000);
        let rate_before = f.vault.get_exchange_rate();

        let benefactor = funded_user(&f, 50_0000000);
        let vault_before = f.xlm.balance(&f.vault_id);
        f.vault.add_rewards(&benefactor, &50_0000000);

        // The XLM actually arrived.
        assert_eq!(f.xlm.balance(&f.vault_id) - vault_before, 50_0000000);
        // 10% is booked as fee and does not back shares.
        assert_eq!(f.vault.treasury_balance(), 5_0000000);
        assert!(f.vault.get_exchange_rate() > rate_before);
    }

    #[test]
    #[should_panic]
    fn add_rewards_without_the_xlm_fails() {
        let env = Env::default();
        let f = setup(&env);
        let user = funded_user(&f, 100_0000000);
        f.vault.deposit(&user, &100_0000000);

        // Benefactor holds nothing; the transfer must fail rather than
        // conjuring a higher exchange rate.
        let broke = Address::generate(&env);
        f.vault.add_rewards(&broke, &50_0000000);
    }

    #[test]
    fn total_assets_ignores_unbacked_claims() {
        let env = Env::default();
        let f = setup(&env);

        let user = funded_user(&f, 100_0000000);
        f.vault.deposit(&user, &100_0000000);

        let benefactor = funded_user(&f, 100_0000000);
        f.vault.add_rewards(&benefactor, &100_0000000);

        // Treasury is inside the contract balance but is not share backing.
        assert_eq!(
            f.vault.total_assets(),
            f.vault.idle_balance() - f.vault.treasury_balance()
        );
    }

    // ------------------------------------------------------------------
    // Fees
    // ------------------------------------------------------------------

    #[test]
    #[should_panic(expected = "insufficient treasury balance")]
    fn fees_cannot_exceed_what_was_earned() {
        let env = Env::default();
        let f = setup(&env);
        let user = funded_user(&f, 100_0000000);
        f.vault.deposit(&user, &100_0000000);
        f.vault.withdraw_fees(&10_0000000);
    }

    #[test]
    fn fee_withdrawal_leaves_share_backing_untouched() {
        let env = Env::default();
        let f = setup(&env);

        let user = funded_user(&f, 100_0000000);
        f.vault.deposit(&user, &100_0000000);

        let benefactor = funded_user(&f, 100_0000000);
        f.vault.add_rewards(&benefactor, &100_0000000);

        let assets_before = f.vault.total_assets();
        f.vault.withdraw_fees(&0);
        assert_eq!(f.vault.treasury_balance(), 0);
        assert_eq!(f.vault.total_assets(), assets_before);
    }

    // ------------------------------------------------------------------
    // Withdrawal fee
    // ------------------------------------------------------------------

    #[test]
    fn the_withdrawal_fee_stays_with_the_holders_who_remain() {
        let env = Env::default();
        let f = setup(&env);

        let leaver = funded_user(&f, 100_0000000);
        let stayer = funded_user(&f, 100_0000000);
        f.vault.deposit(&leaver, &100_0000000);
        f.vault.deposit(&stayer, &100_0000000);

        let rate_before = f.vault.get_exchange_rate();
        let shares = f.sxlm.balance(&leaver);
        let paid_out_before = f.xlm.balance(&leaver);

        f.vault.request_withdrawal(&leaver, &shares);
        let received = f.xlm.balance(&leaver) - paid_out_before;

        // The leaver is short by the fee...
        let gross = shares * rate_before / RATE_PRECISION;
        let expected_fee = gross * f.vault.withdrawal_fee_bps() / 10_000;
        assert!(
            (gross - received - expected_fee).abs() <= 2,
            "fee charged was not the fee configured"
        );

        // ...and that shortfall is exactly what lifts the remaining shares.
        assert!(
            f.vault.get_exchange_rate() > rate_before,
            "the fee did not reach the holders who stayed"
        );
    }

    #[test]
    fn a_zero_withdrawal_fee_pays_out_in_full() {
        let env = Env::default();
        let f = setup(&env);
        f.vault.set_param(&symbol_short!("wd_fee"), &0);

        let user = funded_user(&f, 100_0000000);
        f.vault.deposit(&user, &100_0000000);
        let rate = f.vault.get_exchange_rate();
        let shares = f.sxlm.balance(&user);
        let before = f.xlm.balance(&user);

        f.vault.request_withdrawal(&user, &shares);
        let received = f.xlm.balance(&user) - before;
        assert!((received - shares * rate / RATE_PRECISION).abs() <= 2);
    }

    // ------------------------------------------------------------------
    // Flash loans
    // ------------------------------------------------------------------

    #[test]
    fn a_repaid_flash_loan_lifts_the_rate() {
        let env = Env::default();
        let f = setup(&env);

        let user = funded_user(&f, 100_0000000);
        f.vault.deposit(&user, &100_0000000);
        let rate_before = f.vault.get_exchange_rate();

        let borrower = env.register_contract(None, HonestBorrower);
        // Give the borrower enough to cover the fee.
        f.xlm_admin.mint(&borrower, &1_0000000);
        HonestBorrowerClient::new(&env, &borrower).init(&f.xlm.address, &f.vault_id);

        f.vault.flash_loan(&borrower, &50_0000000);

        assert!(
            f.vault.get_exchange_rate() > rate_before,
            "the flash loan fee did not reach holders"
        );
    }

    #[test]
    #[should_panic(expected = "flash loan not repaid with fee")]
    fn an_unrepaid_flash_loan_reverts() {
        let env = Env::default();
        let f = setup(&env);
        let user = funded_user(&f, 100_0000000);
        f.vault.deposit(&user, &100_0000000);

        let thief = env.register_contract(None, Deadbeat);
        f.vault.flash_loan(&thief, &50_0000000);
    }

    /// The attack the reentrancy guard exists for: repay the loan by depositing
    /// it, restoring the balance while minting yourself shares out of thin air.
    /// A panic message does not survive a cross-contract call, so this asserts
    /// only that the attack reverts. `depositing_during_a_flash_loan_is_refused`
    /// below pins the reason.
    #[test]
    #[should_panic]
    fn a_flash_loan_cannot_be_repaid_by_depositing_it() {
        let env = Env::default();
        let f = setup(&env);
        let user = funded_user(&f, 100_0000000);
        f.vault.deposit(&user, &100_0000000);

        let attacker = env.register_contract(None, DepositAttacker);
        DepositAttackerClient::new(&env, &attacker).init(&f.vault_id);
        f.vault.flash_loan(&attacker, &50_0000000);
    }

    #[test]
    #[should_panic(expected = "reentrant call during flash loan")]
    fn depositing_during_a_flash_loan_is_refused() {
        let env = Env::default();
        let f = setup(&env);
        let user = funded_user(&f, 100_0000000);
        f.vault.deposit(&user, &100_0000000);

        // Stand in for the state mid-loan.
        env.as_contract(&f.vault_id, || {
            env.storage().instance().set(&DataKey::FlashLoanActive, &true);
        });

        f.vault.deposit(&user, &10_0000000);
    }

    #[test]
    #[should_panic(expected = "insufficient unencumbered balance")]
    fn a_flash_loan_cannot_exceed_free_balance() {
        let env = Env::default();
        let f = setup(&env);
        let user = funded_user(&f, 100_0000000);
        f.vault.deposit(&user, &100_0000000);

        let borrower = env.register_contract(None, HonestBorrower);
        f.vault.flash_loan(&borrower, &500_0000000);
    }

    // ------------------------------------------------------------------
    // Invariants across a long sequence
    // ------------------------------------------------------------------

    /// The property the whole design rests on: nothing a user can do raises the
    /// exchange rate. Only XLM arriving does. Deposits and withdrawals must
    /// leave it flat, and rounding must never favour the person acting.
    #[test]
    fn users_cannot_move_the_exchange_rate() {
        let env = Env::default();
        let f = setup(&env);

        let a = funded_user(&f, 500_0000000);
        let b = funded_user(&f, 500_0000000);
        let c = funded_user(&f, 500_0000000);

        f.vault.deposit(&a, &100_0000000);
        let mut rate = f.vault.get_exchange_rate();

        // Awkward, non-round amounts, interleaved, to shake out rounding.
        let steps: [(u32, i128); 8] = [
            (1, 33_3333333), (2, 7_7777777), (0, 12_1212121), (1, 91_9191919),
            (2, 3_1415926), (0, 44_4444444), (1, 1_0000001), (2, 88_8888888),
        ];
        for (who, amount) in steps {
            let user = match who { 0 => &a, 1 => &b, _ => &c };
            f.vault.deposit(user, &amount);
            let after = f.vault.get_exchange_rate();
            assert!(after <= rate + 1, "deposit raised the rate");
            rate = after;

            let shares = f.sxlm.balance(user);
            if shares > 2 {
                f.vault.request_withdrawal(user, &(shares / 3));
                let after = f.vault.get_exchange_rate();
                // Only the withdrawal fee may lift it, and nothing may drop it.
                assert!(after >= rate, "withdrawal dropped the rate");
                rate = after;
            }
        }

        // Solvency held throughout: the contract can still cover every share.
        let assets = f.vault.total_assets();
        let supply = f.vault.total_sxlm_supply();
        assert!(assets >= 0);
        assert!(f.xlm.balance(&f.vault_id) >= assets, "shares outrun the balance");
        assert!(supply >= MINIMUM_LIQUIDITY, "dead shares were redeemed");
    }

    #[test]
    fn only_contributed_xlm_lifts_the_rate() {
        let env = Env::default();
        let f = setup(&env);

        let a = funded_user(&f, 200_0000000);
        f.vault.deposit(&a, &100_0000000);
        let before = f.vault.get_exchange_rate();

        // A second depositor cannot lift it...
        let b = funded_user(&f, 200_0000000);
        f.vault.deposit(&b, &200_0000000);
        assert!(f.vault.get_exchange_rate() <= before + 1);

        // ...and a contribution does, by exactly what arrived net of the fee.
        let donor = funded_user(&f, 100_0000000);
        f.vault.add_rewards(&donor, &100_0000000);
        assert!(f.vault.get_exchange_rate() > before);
    }

    // ------------------------------------------------------------------
    // Housekeeping
    // ------------------------------------------------------------------

    #[test]
    #[should_panic(expected = "already initialized")]
    fn double_initialize_panics() {
        let env = Env::default();
        let f = setup(&env);
        let other = Address::generate(&env);
        f.vault.initialize(&f.admin, &other, &other, &100u32);
    }

    #[test]
    #[should_panic(expected = "already migrated")]
    fn fresh_deploy_needs_no_migration() {
        let env = Env::default();
        let f = setup(&env);
        f.vault.migrate_v2();
    }

    #[test]
    fn pause_blocks_deposits() {
        let env = Env::default();
        let f = setup(&env);
        assert_eq!(f.vault.is_paused(), false);
        f.vault.pause();
        assert_eq!(f.vault.is_paused(), true);
        f.vault.unpause();
        assert_eq!(f.vault.is_paused(), false);
    }

    // ------------------------------------------------------------------
    // Version 3: withdrawal storage, authority, treasury
    // ------------------------------------------------------------------

    /// Move idle XLM out as if a strategy held it, keeping it on the books.
    /// Total assets are unchanged, but the free balance shrinks, which is
    /// what pushes withdrawals into the queue.
    fn deploy_out(f: &Fixture, amount: i128) {
        let sink = Address::generate(&f.env);
        f.env.as_contract(&f.vault_id, || {
            f.xlm.transfer(&f.vault_id, &sink, &amount);
            let deployed = read_i128(&f.env, &DataKey::DeployedToStrategies);
            write_i128(&f.env, &DataKey::DeployedToStrategies, deployed + amount);
        });
    }

    /// Bring deployed XLM back, as if a strategy returned it.
    fn return_in(f: &Fixture, amount: i128) {
        f.xlm_admin.mint(&f.vault_id, &amount);
        f.env.as_contract(&f.vault_id, || {
            let deployed = read_i128(&f.env, &DataKey::DeployedToStrategies);
            write_i128(&f.env, &DataKey::DeployedToStrategies, deployed - amount);
        });
    }

    /// A user with a queued (not instant) withdrawal.
    fn queued_user(f: &Fixture, deposit: i128) -> (Address, u64) {
        let user = funded_user(f, deposit);
        f.vault.deposit(&user, &deposit);
        let free = f.vault.liquidity_buffer();
        if free > 0 {
            deploy_out(f, free);
        }
        let before = f.vault.withdrawal_count();
        f.vault.request_withdrawal(&user, &f.sxlm.balance(&user));
        assert_eq!(f.vault.withdrawal_count(), before + 1, "withdrawal was not queued");
        (user, before)
    }

    #[test]
    fn reports_version_3() {
        let env = Env::default();
        let f = setup(&env);
        assert_eq!(f.vault.version(), 3);
    }

    #[test]
    fn a_claim_removes_the_request() {
        let env = Env::default();
        let f = setup(&env);
        let (alice, id) = queued_user(&f, 100_0000000);

        let owed = f.vault.get_withdrawal(&id).xlm_amount;
        assert_eq!(f.vault.get_user_withdrawals(&alice).len(), 1);
        assert_eq!(f.vault.pending_withdrawals(), owed);

        return_in(&f, owed);
        env.ledger().with_mut(|l| l.sequence_number += 17_280);
        f.vault.claim_withdrawal(&alice, &id);

        assert_eq!(f.xlm.balance(&alice), owed);
        assert_eq!(f.vault.pending_withdrawals(), 0);
        assert_eq!(f.vault.get_user_withdrawals(&alice).len(), 0);
        assert!(f.vault.try_get_withdrawal(&id).is_err(), "claimed request still stored");
        assert!(
            f.vault.try_claim_withdrawal(&alice, &id).is_err(),
            "a request was paid twice"
        );
    }

    #[test]
    fn nobody_else_can_claim_a_request() {
        let env = Env::default();
        let f = setup(&env);
        let (_alice, id) = queued_user(&f, 100_0000000);
        let mallory = Address::generate(&env);
        env.ledger().with_mut(|l| l.sequence_number += 17_280);
        assert!(f.vault.try_claim_withdrawal(&mallory, &id).is_err());
    }

    #[test]
    fn a_claim_before_cooldown_is_refused() {
        let env = Env::default();
        let f = setup(&env);
        let (alice, id) = queued_user(&f, 100_0000000);
        assert!(f.vault.try_claim_withdrawal(&alice, &id).is_err());
    }

    #[test]
    fn each_user_sees_only_their_own_requests_in_order() {
        let env = Env::default();
        let f = setup(&env);
        let (alice, a0) = queued_user(&f, 10_0000000);
        let (bob, b0) = queued_user(&f, 20_0000000);
        f.xlm_admin.mint(&alice, &5_0000000);
        f.vault.deposit(&alice, &5_0000000);
        deploy_out(&f, f.vault.liquidity_buffer());
        let a1 = f.vault.withdrawal_count();
        f.vault.request_withdrawal(&alice, &f.sxlm.balance(&alice));

        let mine = f.vault.get_user_withdrawals(&alice);
        assert_eq!(mine.len(), 2);
        assert_eq!(mine.get(0).unwrap().id, a0);
        assert_eq!(mine.get(1).unwrap().id, a1);
        let theirs = f.vault.get_user_withdrawals(&bob);
        assert_eq!(theirs.len(), 1);
        assert_eq!(theirs.get(0).unwrap().id, b0);
    }

    #[test]
    fn open_requests_per_user_are_capped() {
        let env = Env::default();
        let f = setup(&env);
        let alice = funded_user(&f, 1_000_0000000);
        f.vault.deposit(&alice, &1_000_0000000);
        deploy_out(&f, f.vault.liquidity_buffer());
        for _ in 0..MAX_OPEN_WITHDRAWALS_PER_USER {
            f.vault.request_withdrawal(&alice, &1_0000000);
        }
        assert!(f.vault.try_request_withdrawal(&alice, &1_0000000).is_err());
    }

    /// The legacy queue held every request in one entry and failed somewhere
    /// past 300 lifetime requests. Per-request storage keeps a claim's cost
    /// flat: request number 400 claims within the default per-call budget.
    #[test]
    fn claims_stay_cheap_as_requests_accumulate() {
        let env = Env::default();
        let f = setup(&env);
        env.budget().reset_unlimited();

        let mut last = None;
        for _ in 0..400 {
            last = Some(queued_user(&f, 1_0000000));
        }
        let (user, id) = last.unwrap();
        assert_eq!(f.vault.withdrawal_count(), 400);

        let owed = f.vault.get_withdrawal(&id).xlm_amount;
        return_in(&f, owed);
        env.ledger().with_mut(|l| l.sequence_number += 17_280);

        env.budget().reset_default();
        f.vault.claim_withdrawal(&user, &id);
        let used = env.budget().cpu_instruction_cost();
        assert!(used < 10_000_000, "claim cost {} grew with queue size", used);
    }

    /// The live vault: five legacy requests, ids 0-4, three unclaimed and
    /// owing 38,114,885 stroops between them.
    fn seed_legacy_queue(f: &Fixture, owner: &Address) {
        let env = &f.env;
        env.as_contract(&f.vault_id, || {
            let mut queue: Map<u64, WithdrawalRequest> = Map::new(env);
            let amounts = [9_848_024i128, 9_997_655, 18_269_206, 10_000_000, 5_000_000];
            for (i, amount) in amounts.iter().enumerate() {
                queue.set(i as u64, WithdrawalRequest {
                    id: i as u64,
                    user: owner.clone(),
                    xlm_amount: *amount,
                    unlock_ledger: 1,
                    claimed: i >= 3,
                });
            }
            set_legacy_queue(env, &queue);
            env.storage().instance().set(&DataKey::WithdrawalCounter, &5u64);
            write_i128(env, &DataKey::PendingWithdrawals, 38_114_885);
        });
        f.xlm_admin.mint(&f.vault_id, &38_114_885);
    }

    #[test]
    fn legacy_requests_can_be_read_and_claimed_before_migration() {
        let env = Env::default();
        let f = setup(&env);
        let owner = Address::generate(&env);
        seed_legacy_queue(&f, &owner);
        env.ledger().with_mut(|l| l.sequence_number += 10);

        assert_eq!(f.vault.legacy_queue_len(), 5);
        assert_eq!(f.vault.get_withdrawal(&0).xlm_amount, 9_848_024);
        assert!(f.vault.get_withdrawal(&3).claimed);

        f.vault.claim_withdrawal(&owner, &0);
        assert_eq!(f.xlm.balance(&owner), 9_848_024);
        assert_eq!(f.vault.legacy_queue_len(), 4);
        assert_eq!(f.vault.pending_withdrawals(), 38_114_885 - 9_848_024);
        assert!(f.vault.try_claim_withdrawal(&owner, &0).is_err());
        assert!(f.vault.try_claim_withdrawal(&owner, &3).is_err(), "settled legacy request paid again");
    }

    #[test]
    fn migration_moves_open_requests_and_drops_settled_ones() {
        let env = Env::default();
        let f = setup(&env);
        let owner = Address::generate(&env);
        seed_legacy_queue(&f, &owner);
        let pending = f.vault.pending_withdrawals();

        assert_eq!(f.vault.migrate_withdrawals(&2), 3);
        assert_eq!(f.vault.migrate_withdrawals(&2), 1);
        assert_eq!(f.vault.migrate_withdrawals(&2), 0);
        assert_eq!(f.vault.migrate_withdrawals(&2), 0, "a second run must be a no-op");
        assert_eq!(f.vault.legacy_queue_len(), 0);

        let open = f.vault.get_user_withdrawals(&owner);
        assert_eq!(open.len(), 3);
        let total: i128 = open.iter().map(|r| r.xlm_amount).sum();
        assert_eq!(total, 38_114_885);
        assert_eq!(f.vault.pending_withdrawals(), pending, "migration moved value");
        assert!(f.vault.try_get_withdrawal(&3).is_err());

        env.ledger().with_mut(|l| l.sequence_number += 10);
        for r in open.iter() {
            f.vault.claim_withdrawal(&owner, &r.id);
        }
        assert_eq!(f.xlm.balance(&owner), 38_114_885);
        assert_eq!(f.vault.pending_withdrawals(), 0);

        // New requests continue the id sequence instead of reusing 0-4.
        let (_u, id) = queued_user(&f, 10_0000000);
        assert_eq!(id, 5);
    }

    #[test]
    fn the_cooldown_setter_answers_to_governance_once_set() {
        let env = Env::default();
        let f = setup(&env);

        f.vault.set_cooldown_period(&100);
        assert_eq!(env.auths()[0].0, f.admin, "before governance the admin sets it");

        let gov = Address::generate(&env);
        f.vault.set_governance(&gov);
        f.vault.set_cooldown_period(&200);
        assert_eq!(env.auths()[0].0, gov, "the admin key bypassed governance");
        assert_eq!(f.vault.get_cooldown_period(), 200);
    }

    #[test]
    fn fees_are_paid_to_the_treasury() {
        let env = Env::default();
        let f = setup(&env);
        let user = funded_user(&f, 100_0000000);
        f.vault.deposit(&user, &100_0000000);
        let funder = funded_user(&f, 10_0000000);
        f.vault.add_rewards(&funder, &10_0000000);

        let treasury = Address::generate(&env);
        f.vault.set_treasury(&treasury);
        assert_eq!(f.vault.treasury(), treasury);

        let fees = f.vault.treasury_balance();
        assert!(fees > 0);
        f.vault.withdraw_fees(&0);
        assert_eq!(f.xlm.balance(&treasury), fees);
        assert_eq!(f.xlm.balance(&f.admin), 0);
    }

    #[test]
    fn admin_rotation_needs_both_keys() {
        let env = Env::default();
        let f = setup(&env);
        let next = Address::generate(&env);
        f.vault.set_admin(&next);
        let signers: std::vec::Vec<Address> = env.auths().iter().map(|a| a.0.clone()).collect();
        assert!(signers.contains(&f.admin));
        assert!(signers.contains(&next));
        assert_eq!(f.vault.admin(), next);
    }

    /// Instance storage exactly as read from mainnet on 2026-11-23, including
    /// keys earlier versions left behind. Version 3 must read every live
    /// setting correctly from it with no migration call.
    #[test]
    fn reads_the_live_mainnet_storage_unchanged() {
        #[derive(Clone)]
        #[contracttype]
        enum Orphan {
            LiquidityBuffer,
            TotalSxlmSupply,
            TotalXlmStaked,
        }

        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let native = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let sxlm = env.register_contract(None, MockSxlm);
        let vault_id = env.register_contract(None, VaultContract);
        env.as_contract(&vault_id, || {
            let st = env.storage().instance();
            st.set(&DataKey::Admin, &admin);
            st.set(&DataKey::CooldownPeriod, &181_440u32);
            st.set(&DataKey::DeployedToStrategies, &0i128);
            st.set(&DataKey::Initialized, &true);
            st.set(&DataKey::MigratedV2, &true);
            st.set(&DataKey::NativeToken, &native);
            st.set(&DataKey::Paused, &false);
            st.set(&DataKey::PendingWithdrawals, &38_114_885i128);
            st.set(&DataKey::SxlmToken, &sxlm);
            st.set(&DataKey::Treasury, &admin);
            st.set(&DataKey::TreasuryBalance, &0i128);
            st.set(&DataKey::WithdrawalCounter, &5u64);
            st.set(&Orphan::LiquidityBuffer, &0i128);
            st.set(&Orphan::TotalSxlmSupply, &329_453_105i128);
            st.set(&Orphan::TotalXlmStaked, &687_565_055i128);
        });
        let v = VaultContractClient::new(&env, &vault_id);
        assert_eq!(v.version(), 3);
        assert_eq!(v.protocol_fee_bps(), DEFAULT_PROTOCOL_FEE_BPS);
        assert_eq!(v.withdrawal_fee_bps(), DEFAULT_WITHDRAWAL_FEE_BPS);
        assert_eq!(v.flash_fee_bps(), DEFAULT_FLASH_FEE_BPS);
        assert_eq!(v.get_cooldown_period(), 181_440);
        assert_eq!(v.pending_withdrawals(), 38_114_885);
        assert_eq!(v.withdrawal_count(), 5);
        assert_eq!(v.legacy_queue_len(), 0);
        assert_eq!(v.treasury(), admin);
        assert!(!v.is_paused());
    }

    // ------------------------------------------------------------------
    // Property tests: random sequences of user actions, invariants after
    // every step.
    // ------------------------------------------------------------------

    mod properties {
        use super::*;
        use proptest::prelude::*;
        use std::vec::Vec as StdVec;

        #[derive(Clone, Debug)]
        enum Op {
            Deposit { user: usize, amount: i128 },
            Withdraw { user: usize, pct: u8 },
            Claim { user: usize },
            Wait { ledgers: u32 },
            DeployOut { pct: u8 },
            ReturnIn { pct: u8 },
            Donate { amount: i128 },
        }

        const USERS: usize = 4;

        fn op() -> impl Strategy<Value = Op> {
            prop_oneof![
                4 => (0..USERS, 2_000i128..5_000_0000000).prop_map(|(user, amount)| Op::Deposit { user, amount }),
                3 => (0..USERS, 1u8..=100).prop_map(|(user, pct)| Op::Withdraw { user, pct }),
                2 => (0..USERS).prop_map(|user| Op::Claim { user }),
                1 => (1u32..40_000).prop_map(|ledgers| Op::Wait { ledgers }),
                1 => (1u8..=100).prop_map(|pct| Op::DeployOut { pct }),
                1 => (1u8..=100).prop_map(|pct| Op::ReturnIn { pct }),
                1 => (1i128..10_0000000).prop_map(|amount| Op::Donate { amount }),
            ]
        }

        struct Run<'a> {
            f: Fixture<'a>,
            users: StdVec<Address>,
            allow_donations: bool,
        }

        impl<'a> Run<'a> {
            fn new(env: &'a Env, withdrawal_fee: i128, allow_donations: bool) -> Self {
                // Runs advance the ledger by up to ~1.6M; keep the test token
                // contracts' storage alive for all of it.
                env.ledger().with_mut(|l| {
                    l.min_persistent_entry_ttl = 5_000_000;
                    l.min_temp_entry_ttl = 5_000_000;
                    l.max_entry_ttl = 10_000_000;
                });
                let f = setup(env);
                env.budget().reset_unlimited();
                f.vault.set_param(&symbol_short!("wd_fee"), &withdrawal_fee);
                let users = (0..USERS).map(|_| funded_user(&f, 0)).collect();
                Run { f, users, allow_donations }
            }

            fn rate(&self) -> i128 {
                self.f.vault.get_exchange_rate()
            }

            fn apply(&self, op: &Op) {
                let f = &self.f;
                match op.clone() {
                    Op::Deposit { user, amount } => {
                        let u = &self.users[user];
                        f.xlm_admin.mint(u, &amount);
                        let _ = f.vault.try_deposit(u, &amount);
                    }
                    Op::Withdraw { user, pct } => {
                        let u = &self.users[user];
                        let shares = f.sxlm.balance(u) * pct as i128 / 100;
                        if shares > 0 {
                            let _ = f.vault.try_request_withdrawal(u, &shares);
                        }
                    }
                    Op::Claim { user } => {
                        let u = &self.users[user];
                        if let Some(r) = f.vault.get_user_withdrawals(u).first() {
                            let _ = f.vault.try_claim_withdrawal(u, &r.id);
                        }
                    }
                    Op::Wait { ledgers } => {
                        f.env.ledger().with_mut(|l| l.sequence_number += ledgers);
                    }
                    Op::DeployOut { pct } => {
                        let amount = f.vault.liquidity_buffer() * pct as i128 / 100;
                        if amount > 0 {
                            deploy_out(f, amount);
                        }
                    }
                    Op::ReturnIn { pct } => {
                        let amount = f.vault.deployed_to_strategies() * pct as i128 / 100;
                        if amount > 0 {
                            return_in(f, amount);
                        }
                    }
                    Op::Donate { amount } => {
                        if self.allow_donations {
                            let donor = funded_user(f, amount);
                            f.vault.add_liquidity(&donor, &amount);
                        }
                    }
                }
            }

            /// Invariants that hold after every step of every run.
            fn check(&self) {
                let v = &self.f.vault;
                let idle = v.idle_balance();
                let deployed = v.deployed_to_strategies();
                let pending = v.pending_withdrawals();
                let fees = v.treasury_balance();

                // Assets are derived, never stored: the identity is exact.
                let expected = idle + deployed - pending - fees;
                assert_eq!(v.total_assets(), if expected < 0 { 0 } else { expected });

                // Queue liability equals the open requests, to the stroop.
                let mut open: i128 = 0;
                for u in self.users.iter() {
                    for r in v.get_user_withdrawals(u).iter() {
                        assert!(!r.claimed);
                        assert_eq!(&r.user, u);
                        open += r.xlm_amount;
                    }
                }
                assert_eq!(pending, open, "pending liability drifted from open requests");

                // Solvent: everything owed is held or deployed.
                assert!(idle + deployed >= pending + fees, "vault owes more than it holds");
            }
        }

        proptest! {
            #![proptest_config(ProptestConfig { cases: 48, ..ProptestConfig::default() })]

            /// No sequence of user actions lowers the exchange rate. Only a
            /// real loss could, and users cannot cause one.
            #[test]
            fn the_rate_never_falls(ops in proptest::collection::vec(op(), 1..40)) {
                let env = Env::default();
                let run = Run::new(&env, DEFAULT_WITHDRAWAL_FEE_BPS, true);
                let mut rate = run.rate();
                for op in ops.iter() {
                    run.apply(op);
                    run.check();
                    let next = run.rate();
                    prop_assert!(next >= rate, "rate fell from {} to {} on {:?}", rate, next, op);
                    rate = next;
                }
            }

            /// With no fees and no donations nothing flows in, so the rate may
            /// move only by rounding, which always favours the pool and is
            /// worth less than one share per step.
            #[test]
            fn the_rate_never_rises_without_inflow(ops in proptest::collection::vec(op(), 1..40)) {
                let env = Env::default();
                let run = Run::new(&env, 0, false);
                let mut rate = run.rate();
                for op in ops.iter() {
                    run.apply(op);
                    run.check();
                    let next = run.rate();
                    let supply = run.f.vault.total_sxlm_supply();
                    if supply > 0 {
                        let bound = (rate + RATE_PRECISION) / supply + 1;
                        prop_assert!(
                            next - rate <= bound,
                            "rate rose {} (bound {}) with no inflow on {:?}", next - rate, bound, op
                        );
                    }
                    rate = next;
                }
            }

            /// Depositing and immediately withdrawing never returns more than
            /// was put in, and loses no more than the fee plus rounding.
            #[test]
            fn deposit_then_withdraw_is_symmetric(
                warmup in proptest::collection::vec(op(), 0..20),
                amount in 10_000i128..10_000_0000000,
            ) {
                let env = Env::default();
                let run = Run::new(&env, DEFAULT_WITHDRAWAL_FEE_BPS, true);
                // The first deposit locks MINIMUM_LIQUIDITY shares by design;
                // the property is about every deposit after it.
                let seed = funded_user(&run.f, 100_0000000);
                run.f.vault.deposit(&seed, &100_0000000);
                for op in warmup.iter() {
                    run.apply(op);
                }
                // Keep the round trip instant, so the payout is measured directly.
                let deployed = run.f.vault.deployed_to_strategies();
                if deployed > 0 {
                    return_in(&run.f, deployed);
                }

                let user = funded_user(&run.f, amount);
                if run.f.vault.try_deposit(&user, &amount).is_err() {
                    return Ok(());
                }
                let shares = run.f.sxlm.balance(&user);
                prop_assume!(shares > 0);
                let rate = run.rate();
                run.f.vault.request_withdrawal(&user, &shares);
                let back = run.f.xlm.balance(&user);

                prop_assert!(back <= amount, "round trip paid {} for {}", back, amount);
                let fee = amount * DEFAULT_WITHDRAWAL_FEE_BPS / BPS_DENOMINATOR;
                let rounding = rate / RATE_PRECISION + 2;
                prop_assert!(
                    back + fee + rounding >= amount,
                    "round trip lost {} on {} (fee {}, rounding {})", amount - back, amount, fee, rounding
                );
            }

            /// Every queued request pays exactly what it recorded, once.
            #[test]
            fn claims_pay_exactly_once(ops in proptest::collection::vec(op(), 1..40)) {
                let env = Env::default();
                let run = Run::new(&env, DEFAULT_WITHDRAWAL_FEE_BPS, true);
                for op in ops.iter() {
                    run.apply(op);
                }
                let deployed = run.f.vault.deployed_to_strategies();
                if deployed > 0 {
                    return_in(&run.f, deployed);
                }
                env.ledger().with_mut(|l| l.sequence_number += 200_000);

                for u in run.users.iter() {
                    for r in run.f.vault.get_user_withdrawals(u).iter() {
                        let before = run.f.xlm.balance(u);
                        run.f.vault.claim_withdrawal(u, &r.id);
                        prop_assert_eq!(run.f.xlm.balance(u) - before, r.xlm_amount);
                        prop_assert!(run.f.vault.try_claim_withdrawal(u, &r.id).is_err());
                    }
                }
                prop_assert_eq!(run.f.vault.pending_withdrawals(), 0);
                run.check();
            }
        }
    }
}

#[cfg(test)]
mod storage_key_encoding {
    use super::*;
    use soroban_sdk::testutils::storage::Instance;
    use soroban_sdk::{Env, TryFromVal};
    use soroban_sdk::xdr::{ScVal, ScVec};

    /// Upgrading a live contract keeps its storage, so whether this migration is
    /// safe turns on how a `contracttype` enum encodes its key: by variant NAME
    /// or by variant INDEX.
    ///
    /// Index encoding would be catastrophic here. The removed `TotalXlmStaked`
    /// sat at index 3, which `DeployedToStrategies` now occupies, so an upgraded
    /// vault would read 68.75 XLM as funds deployed to a strategy and price
    /// every share against money that is not there.
    #[test]
    fn data_keys_are_addressed_by_name_not_index() {
        let env = Env::default();
        let id = env.register_contract(None, VaultContract);

        env.as_contract(&id, || {
            env.storage().instance().set(&DataKey::DeployedToStrategies, &7i128);
        });

        let found_by_name = env.as_contract(&id, || {
            let mut found = false;
            for (k, _) in env.storage().instance().all().iter() {
                let sc = ScVal::try_from_val(&env, &k).expect("key converts to ScVal");
                if let ScVal::Vec(Some(ScVec(items))) = sc {
                    if let Some(ScVal::Symbol(sym)) = items.first() {
                        if sym.as_slice() == b"DeployedToStrategies" {
                            found = true;
                        }
                    } else {
                        panic!("storage key does not start with a symbol");
                    }
                } else {
                    panic!("storage key is not a vec");
                }
            }
            found
        });

        assert!(
            found_by_name,
            "keys are index-addressed, not name-addressed — the upgrade would corrupt storage"
        );
    }
}
