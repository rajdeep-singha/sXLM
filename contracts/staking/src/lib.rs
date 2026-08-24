#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, BytesN, Env, Map, Vec,
};

/// Precision multiplier for exchange rate calculations (7 decimals).
///
/// 1e7 matches Stellar stroops. This is deliberate: the vault never holds a
/// value more precise than a stroop, so a wider fixed-point scale would add
/// digits that cannot correspond to anything the contract can actually pay out.
const RATE_PRECISION: i128 = 10_000_000; // 1e7

/// Protocol fee in basis points (1000 = 10%).
const PROTOCOL_FEE_BPS: i128 = 1000;
const BPS_DENOMINATOR: i128 = 10_000;

/// Shares burned to the contract itself on the first deposit so that the share
/// price can never be manipulated by donating to an empty vault.
const MINIMUM_LIQUIDITY: i128 = 1000;

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
    Validators,
    WithdrawalQueue,
    WithdrawalCounter,
    Initialized,
    Paused,
    Treasury,
    TreasuryBalance,
    /// One-shot marker for the v2 storage migration.
    MigratedV2,
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

fn get_withdrawal_queue(env: &Env) -> Map<u64, WithdrawalRequest> {
    let queue: Map<u64, WithdrawalRequest> = env
        .storage()
        .persistent()
        .get(&DataKey::WithdrawalQueue)
        .unwrap_or(Map::new(env));
    // Extend TTL whenever we read the queue
    if env.storage().persistent().has(&DataKey::WithdrawalQueue) {
        extend_queue(env);
    }
    queue
}

fn set_withdrawal_queue(env: &Env, queue: &Map<u64, WithdrawalRequest>) {
    env.storage()
        .persistent()
        .set(&DataKey::WithdrawalQueue, queue);
    extend_queue(env);
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
pub struct StakingContract;

#[contractimpl]
impl StakingContract {
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
    /// The old build burned shares for queued withdrawals without ever
    /// recording the matching liability. Upgrading without this call would let
    /// `total_assets()` count XLM that is already owed to the queue, so the
    /// exchange rate would jump for whoever is still holding shares. This
    /// reconstructs the liability from the queue itself.
    ///
    /// The legacy `TotalXlmStaked`, `TotalSxlmSupply` and `LiquidityBuffer`
    /// entries are intentionally left orphaned; nothing reads them any more.
    pub fn migrate_v2(env: Env) {
        let admin = read_admin(&env);
        admin.require_auth();
        if env.storage().instance().has(&DataKey::MigratedV2) {
            panic!("already migrated");
        }
        extend_instance(&env);

        let queue = get_withdrawal_queue(&env);
        let mut pending: i128 = 0;
        for (_, request) in queue.iter() {
            if !request.claimed {
                pending += request.xlm_amount;
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

    /// Bump instance TTL — can be called by anyone to keep the contract alive.
    pub fn bump_instance(env: Env) {
        extend_instance(&env);
    }

    // ==========================================================
    // Core staking functions
    // ==========================================================

    /// Deposit XLM and receive sXLM tokens.
    pub fn deposit(env: Env, user: Address, xlm_amount: i128) {
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

        let xlm_to_return = sxlm_amount * assets / supply;
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

            let mut queue = get_withdrawal_queue(&env);
            queue.set(id, request);
            set_withdrawal_queue(&env, &queue);

            env.events().publish(
                (soroban_sdk::symbol_short!("delayed"),),
                (user, xlm_to_return, id, unlock_ledger),
            );
        }
    }

    /// Claim a delayed withdrawal after cooldown has expired.
    pub fn claim_withdrawal(env: Env, user: Address, withdrawal_id: u64) {
        user.require_auth();
        extend_instance(&env);

        let mut queue = get_withdrawal_queue(&env);
        let mut request = queue.get(withdrawal_id).expect("withdrawal not found");

        if request.user != user {
            panic!("not your withdrawal");
        }
        if request.claimed {
            panic!("already claimed");
        }
        if env.ledger().sequence() < request.unlock_ledger {
            panic!("cooldown not expired");
        }

        request.claimed = true;
        queue.set(withdrawal_id, request.clone());
        set_withdrawal_queue(&env, &queue);

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

        let fee = amount * PROTOCOL_FEE_BPS / BPS_DENOMINATOR;
        let net_reward = amount - fee;

        let treasury_bal = read_i128(&env, &DataKey::TreasuryBalance);
        write_i128(&env, &DataKey::TreasuryBalance, treasury_bal + fee);

        env.events().publish(
            (soroban_sdk::symbol_short!("rewards"),),
            (amount, net_reward, fee),
        );
    }

    /// Withdraw protocol fees to the admin address.
    /// If amount > 0, withdraw that specific amount; if 0, withdraw all.
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

        let native_token_addr = read_native_token(&env);
        let xlm_client = token::Client::new(&env, &native_token_addr);
        xlm_client.transfer(&env.current_contract_address(), &admin, &withdraw_amount);

        write_i128(&env, &DataKey::TreasuryBalance, treasury_bal - withdraw_amount);

        env.events().publish(
            (soroban_sdk::symbol_short!("fee_out"),),
            (admin, withdraw_amount),
        );
    }

    pub fn set_treasury(env: Env, treasury: Address) {
        let admin = read_admin(&env);
        admin.require_auth();
        extend_instance(&env);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
    }

    // ==========================================================
    // Liquidity
    // ==========================================================

    /// Donate XLM to the vault with no shares minted in return.
    ///
    /// Unlike the previous build this credits no separate buffer counter — the
    /// donated XLM is simply part of the balance, so it backs shares like every
    /// other asset instead of being invisible to the exchange rate.
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

    pub fn update_validators(env: Env, validators: Vec<Address>) {
        let admin = read_admin(&env);
        admin.require_auth();
        extend_instance(&env);
        env.storage().instance().set(&DataKey::Validators, &validators);
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin = read_admin(&env);
        admin.require_auth();
        extend_instance(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn set_cooldown_period(env: Env, new_cooldown: u32) {
        let admin = read_admin(&env);
        admin.require_auth();
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

    pub fn protocol_fee_bps(env: Env) -> i128 {
        extend_instance(&env);
        PROTOCOL_FEE_BPS
    }

    pub fn get_cooldown_period(env: Env) -> u32 {
        extend_instance(&env);
        read_cooldown(&env)
    }

    pub fn get_withdrawal(env: Env, withdrawal_id: u64) -> WithdrawalRequest {
        extend_instance(&env);
        let queue = get_withdrawal_queue(&env);
        queue.get(withdrawal_id).expect("withdrawal not found")
    }

    pub fn get_validators(env: Env) -> Vec<Address> {
        extend_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::Validators)
            .unwrap_or(Vec::new(&env))
    }

    pub fn admin(env: Env) -> Address {
        extend_instance(&env);
        read_admin(&env)
    }
}

use soroban_sdk::contractclient;

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
    use soroban_sdk::testutils::Address as _;
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

    struct Fixture<'a> {
        env: Env,
        vault: StakingContractClient<'a>,
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
        let vault_id = env.register_contract(None, StakingContract);

        let vault = StakingContractClient::new(env, &vault_id);
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
        // Paid instantly: the vault holds only the dead shares' backing.
        assert_eq!(f.sxlm.balance(&user), 0);
        assert!(f.xlm.balance(&user) >= 99_9999000);
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

        assert!(
            (rate_after - rate_before).abs() <= 2,
            "exchange rate moved on a withdrawal"
        );
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

    /// The mainnet bug, reproduced at the accounting layer.
    ///
    /// The old build burned shares for a queued withdrawal and left the XLM
    /// counted as backing, so the rate rose for everyone still holding. Here
    /// the liability is subtracted, so it does not.
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
            set_withdrawal_queue(&env, &queue);
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
}
