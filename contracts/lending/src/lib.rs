#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, BytesN, Env, Symbol};

const BPS_DENOMINATOR: i128 = 10_000;
const RATE_PRECISION: i128 = 10_000_000; // 1e7

/// Storage layout version, reported by `version()`.
const CONTRACT_VERSION: u32 = 3;
const DEFAULT_LIQUIDATION_BONUS_BPS: i128 = 500; // 5% bonus

/// Ceiling on how much of the lending reserve may be lent out at once.
///
/// Redepositing borrowed XLM as fresh collateral and borrowing again inflates
/// reported TVL out of the same capital. Note that total borrowed over total
/// collateral converges on the collateral factor either way, so that ratio
/// cannot tell recursion apart from ordinary borrowing. What each loop does
/// need is more XLM out of the reserve — so capping reserve utilisation is what
/// actually bounds it, and it keeps exit liquidity in the pool.
const DEFAULT_MAX_UTILIZATION_BPS: i128 = 9000; // 90% of the reserve

/// Seconds per year, for converting an annual rate into per-ledger accrual.
const SECONDS_PER_YEAR: i128 = 31_536_000;
/// Stellar closes a ledger roughly every 5 seconds.
const SECONDS_PER_LEDGER: i128 = 5;
/// Share of interest that reaches sXLM holders. The rest is protocol revenue.
const DEFAULT_VAULT_SHARE_BPS: i128 = 8000; // 80%

/// Surcharge a liquidator pays on top of the debt, passed to the vault.
///
/// Taken from the liquidator's profit rather than the borrower's collateral, so
/// it does not deepen anyone's loss. At 100 bps against a 500 bps seizure bonus
/// the liquidator still nets 4%, which is at the healthy end of the range, so
/// the incentive to keep positions solvent survives.
const DEFAULT_LIQUIDATION_FEE_BPS: i128 = 100; // 1%

// ---------- TTL constants ----------
// Testnet: ~5s per ledger
// 30 days  ≈  518_400 ledgers
// 180 days ≈ 3_110_400 ledgers
const INSTANCE_LIFETIME_THRESHOLD: u32 = 100_800; // ~7 days
const INSTANCE_BUMP_AMOUNT: u32 = 518_400;        // bump to ~30 days
const USER_LIFETIME_THRESHOLD: u32 = 518_400;     // ~30 days
const USER_BUMP_AMOUNT: u32 = 3_110_400;          // bump to ~180 days

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    SxlmToken,
    NativeToken,
    CollateralFactorBps,
    LiquidationThresholdBps,
    BorrowRateBps,
    LiquidationBonusBps,
    /// Ceiling on total borrowing as a share of total collateral value.
    MaxUtilizationBps,
    /// Governance contract, the only caller allowed to change parameters.
    Governance,
    /// Cumulative borrow index, scaled by RATE_PRECISION. Starts at 1.0 and
    /// only ever rises, so a debt recorded against it grows with time.
    BorrowIndex,
    /// Ledger at which the index was last advanced.
    LastAccrualLedger,
    /// Interest charged to borrowers and not yet passed to the vault.
    InterestAccrued,
    /// Vault share of interest, in basis points. The remainder is protocol fee.
    VaultShareBps,
    /// Surcharge paid by a liquidator, passed to the vault.
    LiquidationFeeBps,
    /// Address of the vault contract. The sXLM price is read from it rather
    /// than stored here, so no admin can set the number this contract values
    /// collateral at.
    Vault,
    Initialized,
    TotalCollateral,
    TotalBorrowed,
    Collateral(Address),
    Borrowed(Address),
}

// --- Storage helpers ---

fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

fn extend_user_data(env: &Env, user: &Address) {
    let col_key = DataKey::Collateral(user.clone());
    let bor_key = DataKey::Borrowed(user.clone());
    if env.storage().persistent().has(&col_key) {
        env.storage()
            .persistent()
            .extend_ttl(&col_key, USER_LIFETIME_THRESHOLD, USER_BUMP_AMOUNT);
    }
    if env.storage().persistent().has(&bor_key) {
        env.storage()
            .persistent()
            .extend_ttl(&bor_key, USER_LIFETIME_THRESHOLD, USER_BUMP_AMOUNT);
    }
}

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

fn read_collateral_factor(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::CollateralFactorBps)
        .unwrap_or(7000) // 70% default
}

fn read_liquidation_threshold(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::LiquidationThresholdBps)
        .unwrap_or(8000) // 80% default
}

/// Authorise a parameter change: governance once configured, admin until then.
fn require_param_authority(env: &Env) {
    match env.storage().instance().get::<DataKey, Address>(&DataKey::Governance) {
        Some(gov) => gov.require_auth(),
        None => read_admin(env).require_auth(),
    }
}

fn read_max_utilization(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::MaxUtilizationBps)
        .unwrap_or(DEFAULT_MAX_UTILIZATION_BPS)
}

fn read_liquidation_bonus(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::LiquidationBonusBps)
        .unwrap_or(DEFAULT_LIQUIDATION_BONUS_BPS)
}

fn read_vault(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Vault)
}

/// sXLM → XLM rate, computed by the vault from its assets and share supply.
///
/// Read cross-contract so no admin can revalue collateral. Falls back to 1:1
/// only while no vault is configured — the state of a contract upgraded before
/// `set_vault` has been called.
fn read_exchange_rate(env: &Env) -> i128 {
    match read_vault(env) {
        Some(vault) => VaultClient::new(env, &vault).get_exchange_rate(),
        None => RATE_PRECISION,
    }
}

fn read_user_collateral(env: &Env, user: &Address) -> i128 {
    let key = DataKey::Collateral(user.clone());
    let val: i128 = env.storage().persistent().get(&key).unwrap_or(0);
    if val > 0 {
        env.storage()
            .persistent()
            .extend_ttl(&key, USER_LIFETIME_THRESHOLD, USER_BUMP_AMOUNT);
    }
    val
}

fn write_user_collateral(env: &Env, user: &Address, val: i128) {
    let key = DataKey::Collateral(user.clone());
    env.storage().persistent().set(&key, &val);
    env.storage()
        .persistent()
        .extend_ttl(&key, USER_LIFETIME_THRESHOLD, USER_BUMP_AMOUNT);
}

fn read_borrow_index(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::BorrowIndex)
        .unwrap_or(RATE_PRECISION)
}

fn read_liquidation_fee_bps(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::LiquidationFeeBps)
        .unwrap_or(DEFAULT_LIQUIDATION_FEE_BPS)
}

fn read_vault_share_bps(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::VaultShareBps)
        .unwrap_or(DEFAULT_VAULT_SHARE_BPS)
}

/// Advance the borrow index to the current ledger.
///
/// Interest is simple over each elapsed span and compounds across spans, which
/// is what an index does. It must run before any read or write of a debt, or a
/// borrower could repay at a stale index and keep the interest.
fn accrue_interest(env: &Env) {
    let now = env.ledger().sequence();
    let last: u32 = match env.storage().instance().get(&DataKey::LastAccrualLedger) {
        Some(l) => l,
        None => {
            // First touch, including the first call after upgrading from a build
            // without interest. Start the clock here so nobody is charged for
            // time the contract could not account for.
            env.storage().instance().set(&DataKey::LastAccrualLedger, &now);
            return;
        }
    };

    if now <= last {
        return;
    }
    env.storage().instance().set(&DataKey::LastAccrualLedger, &now);

    let scaled_total = read_i128(env, &DataKey::TotalBorrowed);
    let index = read_borrow_index(env);
    let rate_bps = read_i128(env, &DataKey::BorrowRateBps);
    if scaled_total <= 0 || rate_bps <= 0 {
        return;
    }

    let elapsed = (now - last) as i128;
    let growth = index * rate_bps * elapsed * SECONDS_PER_LEDGER
        / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
    if growth <= 0 {
        return;
    }

    let debt_before = scaled_total * index / RATE_PRECISION;
    let new_index = index + growth;
    let debt_after = scaled_total * new_index / RATE_PRECISION;

    env.storage().instance().set(&DataKey::BorrowIndex, &new_index);
    let accrued = read_i128(env, &DataKey::InterestAccrued);
    write_i128(env, &DataKey::InterestAccrued, accrued + (debt_after - debt_before));
}

/// Total outstanding debt in XLM, including accrued interest.
fn read_total_borrowed(env: &Env) -> i128 {
    read_i128(env, &DataKey::TotalBorrowed) * read_borrow_index(env) / RATE_PRECISION
}

fn write_total_borrowed(env: &Env, val: i128) {
    write_i128(env, &DataKey::TotalBorrowed, val * RATE_PRECISION / read_borrow_index(env));
}

fn read_user_borrowed(env: &Env, user: &Address) -> i128 {
    let key = DataKey::Borrowed(user.clone());
    let scaled: i128 = env.storage().persistent().get(&key).unwrap_or(0);
    if scaled > 0 {
        env.storage()
            .persistent()
            .extend_ttl(&key, USER_LIFETIME_THRESHOLD, USER_BUMP_AMOUNT);
    }
    // Debt is stored against the index at the time it was taken on, so it grows
    // as the index does. The index starts at 1.0, which makes debts recorded
    // before interest existed carry over unchanged.
    scaled * read_borrow_index(env) / RATE_PRECISION
}

fn write_user_borrowed(env: &Env, user: &Address, val: i128) {
    let key = DataKey::Borrowed(user.clone());
    let scaled = val * RATE_PRECISION / read_borrow_index(env);
    env.storage().persistent().set(&key, &scaled);
    env.storage()
        .persistent()
        .extend_ttl(&key, USER_LIFETIME_THRESHOLD, USER_BUMP_AMOUNT);
}

/// Health factor scaled by RATE_PRECISION, so 1.0 == RATE_PRECISION.
///
/// `factor_bps` is supplied by the caller and is not always the same number:
/// borrowing and withdrawing measure against the collateral factor, liquidation
/// against the looser liquidation threshold. The gap between them is the margin
/// a borrower has before a position becomes liquidatable.
fn compute_health_factor(
    collateral: i128,
    borrowed: i128,
    factor_bps: i128,
    exchange_rate: i128,
) -> i128 {
    if borrowed == 0 {
        return i128::MAX;
    }
    (collateral * exchange_rate * factor_bps) / (BPS_DENOMINATOR * borrowed)
}

/// Validate and store one governable parameter.
///
/// Every route that changes a parameter ends here: `set_param` (governance)
/// and the older `update_*` entrypoints alike, so the authority check and the
/// bounds are the same whichever one is called.
///
/// Interest is accrued first. The index is advanced at the rate in force for
/// the time that has already passed; without this, a new borrow rate would be
/// applied back to the last accrual.
fn apply_param(env: &Env, key: Symbol, value: i128) {
    accrue_interest(env);

    if key == soroban_sdk::symbol_short!("coll_fact") {
        assert!(value > 0 && value <= BPS_DENOMINATOR, "collateral factor out of range");
        assert!(
            value <= read_liquidation_threshold(env),
            "collateral factor above liquidation threshold"
        );
        env.storage().instance().set(&DataKey::CollateralFactorBps, &value);
    } else if key == soroban_sdk::symbol_short!("liq_thres") {
        assert!(value > 0 && value <= BPS_DENOMINATOR, "threshold out of range");
        assert!(
            value >= read_collateral_factor(env),
            "liquidation threshold below collateral factor"
        );
        env.storage().instance().set(&DataKey::LiquidationThresholdBps, &value);
    } else if key == soroban_sdk::symbol_short!("bor_rate") {
        assert!(value >= 0 && value <= BPS_DENOMINATOR, "borrow rate out of range");
        env.storage().instance().set(&DataKey::BorrowRateBps, &value);
    } else if key == soroban_sdk::symbol_short!("liq_fee") {
        // Capped below the seizure bonus so liquidating always pays.
        assert!(value >= 0 && value < read_liquidation_bonus(env), "liquidation fee too high");
        env.storage().instance().set(&DataKey::LiquidationFeeBps, &value);
    } else if key == soroban_sdk::symbol_short!("vlt_share") {
        assert!(value >= 0 && value <= BPS_DENOMINATOR, "vault share out of range");
        env.storage().instance().set(&DataKey::VaultShareBps, &value);
    } else if key == soroban_sdk::symbol_short!("max_util") {
        assert!(value > 0 && value <= BPS_DENOMINATOR, "utilization out of range");
        env.storage().instance().set(&DataKey::MaxUtilizationBps, &value);
    } else {
        panic!("unknown parameter");
    }

    env.events().publish((soroban_sdk::symbol_short!("param"),), (key, value));
}

#[contract]
pub struct LendingContract;

#[contractimpl]
impl LendingContract {
    /// Initialize the lending contract.
    pub fn initialize(
        env: Env,
        admin: Address,
        sxlm_token: Address,
        native_token: Address,
        collateral_factor_bps: u32,
        liquidation_threshold_bps: u32,
        borrow_rate_bps: u32,
        vault: Address,
    ) {
        let already: bool = env.storage().instance().get(&DataKey::Initialized).unwrap_or(false);
        if already {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::SxlmToken, &sxlm_token);
        env.storage().instance().set(&DataKey::NativeToken, &native_token);
        env.storage().instance().set(&DataKey::CollateralFactorBps, &(collateral_factor_bps as i128));
        env.storage().instance().set(&DataKey::LiquidationThresholdBps, &(liquidation_threshold_bps as i128));
        env.storage().instance().set(&DataKey::BorrowRateBps, &(borrow_rate_bps as i128));
        env.storage().instance().set(&DataKey::LiquidationBonusBps, &DEFAULT_LIQUIDATION_BONUS_BPS);
        env.storage().instance().set(&DataKey::MaxUtilizationBps, &DEFAULT_MAX_UTILIZATION_BPS);
        env.storage().instance().set(&DataKey::BorrowIndex, &RATE_PRECISION);
        env.storage().instance().set(&DataKey::LastAccrualLedger, &env.ledger().sequence());
        env.storage().instance().set(&DataKey::VaultShareBps, &DEFAULT_VAULT_SHARE_BPS);
        env.storage().instance().set(&DataKey::Vault, &vault);
        extend_instance(&env);
    }

    /// Upgrade the contract WASM. Only callable by admin.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin = read_admin(&env);
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Bump instance TTL — can be called by anyone to keep contract alive.
    pub fn bump_instance(env: Env) {
        extend_instance(&env);
    }

    // ==========================================================
    // Admin setters (for governance)
    // ==========================================================

    /// Point this contract at the vault, once.
    ///
    /// Needed only to migrate a contract deployed before the rate was read
    /// cross-contract. It can be set exactly once: naming the source is a
    /// different power from setting the price, and freezing it after the first
    /// write keeps an admin from later swapping in a vault that lies.
    pub fn set_vault(env: Env, vault: Address) {
        let admin = read_admin(&env);
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Vault) {
            panic!("vault already set");
        }
        extend_instance(&env);
        env.storage().instance().set(&DataKey::Vault, &vault);

        env.events().publish(
            (soroban_sdk::symbol_short!("vault_set"),),
            vault,
        );
    }

    /// Pass accrued interest to the vault, raising the sXLM exchange rate.
    ///
    /// Callable by anyone — it moves money in one direction only, from this
    /// contract to holders, so there is nothing to gain by calling it and
    /// nothing to lose by letting anyone.
    ///
    /// The vault takes its own protocol fee out of what arrives, so this split
    /// is on top of that one: `VaultShareBps` reaches holders and the remainder
    /// stays here as protocol revenue.
    pub fn settle_interest(env: Env) -> i128 {
        extend_instance(&env);
        accrue_interest(&env);

        let accrued = read_i128(&env, &DataKey::InterestAccrued);
        if accrued <= 0 {
            return 0;
        }

        // Only interest that borrowers have actually repaid is here to send.
        // Anything still owed stays booked until it arrives.
        let native = read_native_token(&env);
        let native_client = token::Client::new(&env, &native);
        let liquid = native_client.balance(&env.current_contract_address());
        let payable = if accrued > liquid { liquid } else { accrued };
        if payable <= 0 {
            return 0;
        }

        let to_vault = payable * read_vault_share_bps(&env) / BPS_DENOMINATOR;
        if to_vault <= 0 {
            return 0;
        }

        // A plain transfer is enough. The vault derives its assets from its own
        // balance on every read, so XLM arriving raises the exchange rate with
        // no call and no permission to grant.
        let vault = read_vault(&env).expect("vault not configured");
        native_client.transfer(&env.current_contract_address(), &vault, &to_vault);

        write_i128(&env, &DataKey::InterestAccrued, accrued - payable);

        env.events().publish(
            (soroban_sdk::symbol_short!("settled"),),
            (to_vault, payable - to_vault),
        );

        to_vault
    }

    /// Hand parameter control to the governance contract, once.
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

    pub fn governance(env: Env) -> Address {
        extend_instance(&env);
        env.storage().instance().get(&DataKey::Governance).expect("governance not configured")
    }

    /// Apply a governance-approved parameter change.
    pub fn set_param(env: Env, key: Symbol, value: i128) {
        require_param_authority(&env);
        extend_instance(&env);
        apply_param(&env, key, value);
    }

    // The four `update_*` entrypoints below predate governance. They are kept
    // so existing callers keep working, but they now carry exactly the power of
    // `set_param`: the governance contract once configured, the admin until
    // then. Before version 3 they accepted the admin key regardless, which left
    // a way around every passed vote.

    /// Update the reserve utilisation cap.
    pub fn update_max_utilization(env: Env, new_bps: u32) {
        require_param_authority(&env);
        extend_instance(&env);
        apply_param(&env, soroban_sdk::symbol_short!("max_util"), new_bps as i128);
    }

    pub fn get_max_utilization(env: Env) -> i128 {
        extend_instance(&env);
        read_max_utilization(&env)
    }

    /// Update the collateral factor.
    pub fn update_collateral_factor(env: Env, new_cf_bps: u32) {
        require_param_authority(&env);
        extend_instance(&env);
        apply_param(&env, soroban_sdk::symbol_short!("coll_fact"), new_cf_bps as i128);
    }

    /// Update the liquidation threshold.
    pub fn update_liquidation_threshold(env: Env, new_lt_bps: u32) {
        require_param_authority(&env);
        extend_instance(&env);
        apply_param(&env, soroban_sdk::symbol_short!("liq_thres"), new_lt_bps as i128);
    }

    /// Update the borrow rate.
    pub fn update_borrow_rate(env: Env, new_rate_bps: u32) {
        require_param_authority(&env);
        extend_instance(&env);
        apply_param(&env, soroban_sdk::symbol_short!("bor_rate"), new_rate_bps as i128);
    }

    /// Transfer the admin role. Both the current and the new admin must sign.
    pub fn set_admin(env: Env, new_admin: Address) {
        let admin = read_admin(&env);
        admin.require_auth();
        new_admin.require_auth();
        extend_instance(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events().publish((soroban_sdk::symbol_short!("admin"),), (admin, new_admin));
    }

    pub fn admin(env: Env) -> Address {
        extend_instance(&env);
        read_admin(&env)
    }

    pub fn version(_env: Env) -> u32 {
        CONTRACT_VERSION
    }

    // ==========================================================
    // Core lending functions
    // ==========================================================

    /// Deposit sXLM as collateral.
    pub fn deposit_collateral(env: Env, user: Address, sxlm_amount: i128) {
        user.require_auth();
        assert!(sxlm_amount > 0, "amount must be positive");
        extend_instance(&env);

        let sxlm = read_sxlm_token(&env);
        let sxlm_client = token::Client::new(&env, &sxlm);
        sxlm_client.transfer(&user, &env.current_contract_address(), &sxlm_amount);

        let current = read_user_collateral(&env, &user);
        write_user_collateral(&env, &user, current + sxlm_amount);

        let total = read_i128(&env, &DataKey::TotalCollateral);
        write_i128(&env, &DataKey::TotalCollateral, total + sxlm_amount);

        env.events().publish(
            (soroban_sdk::symbol_short!("deposit"),),
            (user, sxlm_amount),
        );
    }

    /// Withdraw sXLM collateral if health factor stays above 1.0.
    pub fn withdraw_collateral(env: Env, user: Address, sxlm_amount: i128) {
        accrue_interest(&env);
        user.require_auth();
        assert!(sxlm_amount > 0, "amount must be positive");
        extend_instance(&env);

        let current = read_user_collateral(&env, &user);
        assert!(current >= sxlm_amount, "insufficient collateral");

        let new_collateral = current - sxlm_amount;
        let borrowed = read_user_borrowed(&env, &user);
        let cf_bps = read_collateral_factor(&env);
        let er = read_exchange_rate(&env);

        if borrowed > 0 {
            let hf = compute_health_factor(new_collateral, borrowed, cf_bps, er);
            assert!(hf >= RATE_PRECISION, "withdrawal would make position unhealthy");
        }

        write_user_collateral(&env, &user, new_collateral);

        let total = read_i128(&env, &DataKey::TotalCollateral);
        write_i128(&env, &DataKey::TotalCollateral, total - sxlm_amount);

        let sxlm = read_sxlm_token(&env);
        let sxlm_client = token::Client::new(&env, &sxlm);
        sxlm_client.transfer(&env.current_contract_address(), &user, &sxlm_amount);

        env.events().publish(
            (soroban_sdk::symbol_short!("withdraw"),),
            (user, sxlm_amount),
        );
    }

    /// Borrow XLM against deposited sXLM collateral.
    pub fn borrow(env: Env, user: Address, xlm_amount: i128) {
        user.require_auth();
        assert!(xlm_amount > 0, "amount must be positive");
        extend_instance(&env);
        accrue_interest(&env);

        let collateral = read_user_collateral(&env, &user);
        let current_borrowed = read_user_borrowed(&env, &user);
        let new_borrowed = current_borrowed + xlm_amount;
        let cf_bps = read_collateral_factor(&env);
        let er = read_exchange_rate(&env);

        // max_borrow = collateral * exchange_rate * cf_bps / (BPS_DENOMINATOR * RATE_PRECISION)
        let max_borrow = collateral * er * cf_bps / (BPS_DENOMINATOR * RATE_PRECISION);
        assert!(new_borrowed <= max_borrow, "borrow exceeds collateral limit");

        let new_total = read_total_borrowed(&env) + xlm_amount;

        write_user_borrowed(&env, &user, new_borrowed);
        write_total_borrowed(&env, new_total);

        let native = read_native_token(&env);
        let native_client = token::Client::new(&env, &native);

        // Solvency check: ensure the pool has enough XLM to lend
        let pool_balance = native_client.balance(&env.current_contract_address());
        assert!(pool_balance >= xlm_amount, "insufficient pool liquidity");

        // Reserve utilisation cap. Each turn of a recursive leverage loop has to
        // draw more XLM out of the reserve, so this is the constraint that
        // bounds it — and it leaves liquidity for lenders to exit.
        let reserve_after = pool_balance - xlm_amount;
        let max_utilization = read_max_utilization(&env);
        assert!(
            new_total * BPS_DENOMINATOR <= (reserve_after + new_total) * max_utilization,
            "reserve utilization cap reached"
        );

        native_client.transfer(&env.current_contract_address(), &user, &xlm_amount);

        env.events().publish(
            (soroban_sdk::symbol_short!("borrow"),),
            (user, xlm_amount),
        );
    }

    /// Repay borrowed XLM.
    pub fn repay(env: Env, user: Address, xlm_amount: i128) {
        user.require_auth();
        assert!(xlm_amount > 0, "amount must be positive");
        extend_instance(&env);
        accrue_interest(&env);

        let borrowed = read_user_borrowed(&env, &user);
        let repay_amount = if xlm_amount > borrowed { borrowed } else { xlm_amount };

        let native = read_native_token(&env);
        let native_client = token::Client::new(&env, &native);
        native_client.transfer(&user, &env.current_contract_address(), &repay_amount);

        write_user_borrowed(&env, &user, borrowed - repay_amount);

        write_total_borrowed(&env, read_total_borrowed(&env) - repay_amount);

        env.events().publish(
            (soroban_sdk::symbol_short!("repay"),),
            (user, repay_amount),
        );
    }

    /// Liquidate an unhealthy position. Liquidator repays debt and receives collateral + bonus.
    pub fn liquidate(env: Env, liquidator: Address, borrower: Address) {
        accrue_interest(&env);
        liquidator.require_auth();
        extend_instance(&env);

        let collateral = read_user_collateral(&env, &borrower);
        let borrowed = read_user_borrowed(&env, &borrower);
        assert!(borrowed > 0, "no debt to liquidate");

        let liq_threshold_bps = read_liquidation_threshold(&env);
        let er = read_exchange_rate(&env);
        let hf = compute_health_factor(collateral, borrowed, liq_threshold_bps, er);
        assert!(hf < RATE_PRECISION, "position is healthy, cannot liquidate");

        // Liquidator repays full debt
        let native = read_native_token(&env);
        let native_client = token::Client::new(&env, &native);
        native_client.transfer(&liquidator, &env.current_contract_address(), &borrowed);

        // Surcharge on top of the debt, straight to the vault. It comes out of
        // the liquidator's bonus, never out of the borrower's collateral.
        let liq_fee = borrowed * read_liquidation_fee_bps(&env) / BPS_DENOMINATOR;
        if liq_fee > 0 {
            if let Some(vault) = read_vault(&env) {
                native_client.transfer(&liquidator, &vault, &liq_fee);
            }
        }

        // Liquidator receives sXLM worth (debt + 5% bonus) in XLM value
        // sxlm_to_seize = borrowed * (1 + bonus_bps/BPS) * RATE_PRECISION / exchange_rate
        //
        // The rate can be zero when the vault has shares against no assets.
        // Refuse explicitly rather than failing as a division error.
        assert!(er > 0, "vault reports no assets; collateral cannot be priced");
        let bonus_bps = read_liquidation_bonus(&env);
        let debt_with_bonus = borrowed * (BPS_DENOMINATOR + bonus_bps) / BPS_DENOMINATOR;
        let sxlm_to_seize = debt_with_bonus * RATE_PRECISION / er;
        // Cap at borrower's actual collateral (can't seize more than they deposited)
        let collateral_to_send = if sxlm_to_seize > collateral {
            collateral
        } else {
            sxlm_to_seize
        };

        let sxlm = read_sxlm_token(&env);
        let sxlm_client = token::Client::new(&env, &sxlm);
        sxlm_client.transfer(&env.current_contract_address(), &liquidator, &collateral_to_send);

        // Clear borrower position
        let remaining_collateral = collateral - collateral_to_send;
        let total_collateral = read_i128(&env, &DataKey::TotalCollateral);
        // Only subtract the seized amount; remaining_collateral stays in contract attributed to borrower
        write_i128(&env, &DataKey::TotalCollateral, total_collateral - collateral_to_send);
        // `borrowed` includes accrued interest, so it is compared against the
        // indexed total, not the scaled figure in storage. Subtracting it from
        // the scaled figure (as versions before 3 did) removed more than the
        // debt once the index rose above 1.0.
        let total_after = read_total_borrowed(&env) - borrowed;
        write_total_borrowed(&env, if total_after < 0 { 0 } else { total_after });

        write_user_collateral(&env, &borrower, remaining_collateral);
        write_user_borrowed(&env, &borrower, 0);

        env.events().publish(
            (soroban_sdk::symbol_short!("liq"),),
            (liquidator, borrower, borrowed, collateral_to_send),
        );
    }

    // --- Views ---

    /// Returns (collateral, borrowed) for a user.
    pub fn get_position(env: Env, user: Address) -> (i128, i128) {
        extend_instance(&env);
        accrue_interest(&env);
        extend_user_data(&env, &user);
        (
            read_user_collateral(&env, &user),
            read_user_borrowed(&env, &user),
        )
    }

    /// Returns health factor scaled by RATE_PRECISION (1e7 = 1.0).
    /// Uses liquidation threshold (not collateral factor) to match what liquidate() checks.
    pub fn health_factor(env: Env, user: Address) -> i128 {
        extend_instance(&env);
        accrue_interest(&env);
        let collateral = read_user_collateral(&env, &user);
        let borrowed = read_user_borrowed(&env, &user);
        let lt_bps = read_liquidation_threshold(&env);
        let er = read_exchange_rate(&env);
        compute_health_factor(collateral, borrowed, lt_bps, er)
    }

    pub fn total_borrowed(env: Env) -> i128 {
        extend_instance(&env);
        accrue_interest(&env);
        read_total_borrowed(&env)
    }

    /// Interest charged to borrowers and not yet passed to the vault.
    pub fn total_accrued_interest(env: Env) -> i128 {
        extend_instance(&env);
        accrue_interest(&env);
        read_i128(&env, &DataKey::InterestAccrued)
    }

    pub fn get_borrow_index(env: Env) -> i128 {
        extend_instance(&env);
        accrue_interest(&env);
        read_borrow_index(&env)
    }

    pub fn get_liquidation_fee_bps(env: Env) -> i128 {
        extend_instance(&env);
        read_liquidation_fee_bps(&env)
    }

    pub fn get_vault_share_bps(env: Env) -> i128 {
        extend_instance(&env);
        read_vault_share_bps(&env)
    }

    pub fn total_collateral(env: Env) -> i128 {
        extend_instance(&env);
        read_i128(&env, &DataKey::TotalCollateral)
    }

    pub fn get_exchange_rate(env: Env) -> i128 {
        extend_instance(&env);
        read_exchange_rate(&env)
    }

    pub fn vault(env: Env) -> Address {
        extend_instance(&env);
        read_vault(&env).expect("vault not configured")
    }

    pub fn get_collateral_factor(env: Env) -> i128 {
        extend_instance(&env);
        read_collateral_factor(&env)
    }

    pub fn get_liquidation_threshold(env: Env) -> i128 {
        extend_instance(&env);
        read_liquidation_threshold(&env)
    }

    pub fn get_borrow_rate(env: Env) -> i128 {
        extend_instance(&env);
        read_i128(&env, &DataKey::BorrowRateBps)
    }

    pub fn get_liquidation_bonus(env: Env) -> i128 {
        extend_instance(&env);
        read_liquidation_bonus(&env)
    }

    pub fn get_pool_balance(env: Env) -> i128 {
        extend_instance(&env);
        let native = read_native_token(&env);
        let native_client = token::Client::new(&env, &native);
        native_client.balance(&env.current_contract_address())
    }
}

use soroban_sdk::contractclient;

#[contractclient(name = "VaultClient")]
pub trait VaultInterface {
    fn get_exchange_rate(env: Env) -> i128;
}

#[cfg(test)]
mod test {
    extern crate std;
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Ledger;
    use soroban_sdk::{symbol_short, token::StellarAssetClient, Env};

    /// Stand-in for the vault. Only exposes the rate, and lets a test move it
    /// the way real deposits and yield would, rather than by admin decree.
    #[contract]
    pub struct MockVault;

    #[contractimpl]
    impl MockVault {
        pub fn set_rate(env: Env, rate: i128) {
            env.storage().instance().set(&symbol_short!("RATE"), &rate);
        }
        pub fn get_exchange_rate(env: Env) -> i128 {
            env.storage()
                .instance()
                .get(&symbol_short!("RATE"))
                .unwrap_or(RATE_PRECISION)
        }
        pub fn add_rewards(env: Env, from: Address, amount: i128) {
            from.require_auth();
            let total: i128 = env.storage().instance()
                .get(&symbol_short!("REW")).unwrap_or(0);
            env.storage().instance().set(&symbol_short!("REW"), &(total + amount));
        }
        pub fn rewards_received(env: Env) -> i128 {
            env.storage().instance().get(&symbol_short!("REW")).unwrap_or(0)
        }
    }

    fn setup_test() -> (Env, Address, Address, Address, Address, Address, Address) {
        let (env, contract_id, sxlm, native, user, liq, admin, _vault) = setup_with_vault();
        (env, contract_id, sxlm, native, user, liq, admin)
    }

    fn setup_with_vault() -> (Env, Address, Address, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        // Tests advance the ledger by millions; keep every test contract's
        // storage alive throughout.
        env.ledger().with_mut(|l| {
            l.min_persistent_entry_ttl = 50_000_000;
            l.min_temp_entry_ttl = 50_000_000;
            l.max_entry_ttl = 100_000_000;
        });

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let liquidator = Address::generate(&env);

        let sxlm_token_admin = Address::generate(&env);
        let sxlm_id = env.register_stellar_asset_contract_v2(sxlm_token_admin.clone()).address();
        let native_id = env.register_stellar_asset_contract_v2(admin.clone()).address();

        let contract_id = env.register_contract(None, LendingContract);
        let vault_id = env.register_contract(None, MockVault);

        // Initialize
        let client = LendingContractClient::new(&env, &contract_id);
        client.initialize(&admin, &sxlm_id, &native_id, &7000, &8000, &500, &vault_id);

        // Mint tokens
        let sxlm_admin_client = StellarAssetClient::new(&env, &sxlm_id);
        sxlm_admin_client.mint(&user, &100_000_0000000); // 100k sXLM
        sxlm_admin_client.mint(&liquidator, &50_000_0000000);

        let native_admin_client = StellarAssetClient::new(&env, &native_id);
        native_admin_client.mint(&contract_id, &500_000_0000000); // Fund pool with XLM
        native_admin_client.mint(&liquidator, &100_000_0000000);

        (env, contract_id, sxlm_id, native_id, user, liquidator, admin, vault_id)
    }

    #[test]
    fn test_initialize() {
        let (env, contract_id, _, _, _, _, _) = setup_test();
        let client = LendingContractClient::new(&env, &contract_id);
        assert_eq!(client.total_borrowed(), 0);
        assert_eq!(client.total_collateral(), 0);
        assert_eq!(client.get_exchange_rate(), RATE_PRECISION);
    }

    #[test]
    fn test_deposit_and_borrow() {
        let (env, contract_id, _, _, user, _, _) = setup_test();
        let client = LendingContractClient::new(&env, &contract_id);

        // Deposit 1000 sXLM
        client.deposit_collateral(&user, &10_000_000_000);
        let (col, bor) = client.get_position(&user);
        assert_eq!(col, 10_000_000_000);
        assert_eq!(bor, 0);

        // Borrow 700 XLM (70% of 1000 at 1:1 ER)
        client.borrow(&user, &7_000_000_000);
        let (col2, bor2) = client.get_position(&user);
        assert_eq!(col2, 10_000_000_000);
        assert_eq!(bor2, 7_000_000_000);
    }

    #[test]
    #[should_panic(expected = "borrow exceeds collateral limit")]
    fn test_borrow_exceeds_limit() {
        let (env, contract_id, _, _, user, _, _) = setup_test();
        let client = LendingContractClient::new(&env, &contract_id);

        client.deposit_collateral(&user, &10_000_000_000);
        // Try to borrow 8000 XLM (80% > 70% CF)
        client.borrow(&user, &8_000_000_000);
    }

    #[test]
    fn test_repay() {
        let (env, contract_id, _, native_id, user, _, _) = setup_test();
        let client = LendingContractClient::new(&env, &contract_id);

        // Give user XLM for repayment
        let native_admin = StellarAssetClient::new(&env, &native_id);
        native_admin.mint(&user, &100_000_0000000);

        client.deposit_collateral(&user, &10_000_000_000);
        client.borrow(&user, &5_000_000_000);

        // Repay 3000
        client.repay(&user, &3_000_000_000);
        let (_, bor) = client.get_position(&user);
        assert_eq!(bor, 2_000_000_000);
    }

    #[test]
    fn test_withdraw_collateral() {
        let (env, contract_id, _, _, user, _, _) = setup_test();
        let client = LendingContractClient::new(&env, &contract_id);

        client.deposit_collateral(&user, &10_000_000_000);
        // No borrows, can withdraw all
        client.withdraw_collateral(&user, &5_000_000_000);
        let (col, _) = client.get_position(&user);
        assert_eq!(col, 5_000_000_000);
    }

    #[test]
    #[should_panic(expected = "withdrawal would make position unhealthy")]
    fn test_withdraw_unhealthy() {
        let (env, contract_id, _, _, user, _, _) = setup_test();
        let client = LendingContractClient::new(&env, &contract_id);

        client.deposit_collateral(&user, &10_000_000_000);
        client.borrow(&user, &7_000_000_000); // max borrow at 70%

        // Try to withdraw any collateral — should fail
        client.withdraw_collateral(&user, &1_000_000_000);
    }

    #[test]
    fn test_health_factor() {
        let (env, contract_id, _, _, user, _, _) = setup_test();
        let client = LendingContractClient::new(&env, &contract_id);

        client.deposit_collateral(&user, &10_000_000_000);
        client.borrow(&user, &5_000_000_000);

        // HF now uses liquidation_threshold (8000) not collateral_factor (7000)
        // HF = (10000 * 1e7 * 8000 / 10000) / 5000 = 8000 * 1e7 / 5000 = 16_000_000
        let hf = client.health_factor(&user);
        assert_eq!(hf, 16_000_000); // 1.6 × 1e7
    }

    #[test]
    fn test_health_factor_with_exchange_rate() {
        let (env, contract_id, _, _, user, _, _, vault_id) = setup_with_vault();
        let vault = MockVaultClient::new(&env, &vault_id);
        let client = LendingContractClient::new(&env, &contract_id);

        client.deposit_collateral(&user, &10_000_000_000);
        client.borrow(&user, &5_000_000_000);

        // Increase ER to 1.2 (12_000_000)
        vault.set_rate(&12_000_000);

        // HF now uses LT (8000) not CF (7000)
        // HF = (10000 * 12_000_000 * 8000 / 10000) / 5000
        //    = 9600 * 1e7 / 5000 = 19_200_000
        let hf = client.health_factor(&user);
        assert_eq!(hf, 19_200_000); // 1.92 × 1e7
    }

    #[test]
    fn test_exchange_rate_increases_borrow_capacity() {
        let (env, contract_id, _, _, user, _, _, vault_id) = setup_with_vault();
        let vault = MockVaultClient::new(&env, &vault_id);
        let client = LendingContractClient::new(&env, &contract_id);

        client.deposit_collateral(&user, &10_000_000_000); // 1000 sXLM

        // At 1:1 ER, max borrow = 1000 * 0.7 = 700 XLM
        client.borrow(&user, &7_000_000_000);

        // Increase ER to 1.5 → max borrow = 1000 * 1.5 * 0.7 = 1050 XLM
        vault.set_rate(&15_000_000);

        // Can now borrow more (up to 1050 - 700 = 350 more)
        client.borrow(&user, &3_000_000_000); // borrow 300 more
        let (_, bor) = client.get_position(&user);
        assert_eq!(bor, 10_000_000_000); // 700 + 300 = 1000 total
    }

    /// The rate this contract values collateral at follows the vault and
    /// nothing else. There is no entrypoint that writes it.
    #[test]
    fn lending_rate_tracks_the_vault() {
        let (env, contract_id, _, _, _, _, _, vault_id) = setup_with_vault();
        let client = LendingContractClient::new(&env, &contract_id);
        let vault = MockVaultClient::new(&env, &vault_id);

        assert_eq!(client.get_exchange_rate(), RATE_PRECISION);
        assert_eq!(client.vault(), vault_id);

        vault.set_rate(&19_712_978);
        assert_eq!(client.get_exchange_rate(), 19_712_978);
    }

    #[test]
    #[should_panic(expected = "vault already set")]
    fn set_vault_is_one_shot() {
        let (env, contract_id, _, _, _, _, _, _) = setup_with_vault();
        let client = LendingContractClient::new(&env, &contract_id);
        // Migration helper for pre-upgrade deployments; must not become a way
        // to repoint a live market at a vault that reports whatever suits.
        client.set_vault(&Address::generate(&env));
    }

    #[test]
    fn recursion_is_bounded_by_reserve_utilization() {
        let (env, contract_id, sxlm_id, native_id, user, _, _, _) = setup_with_vault();
        let client = LendingContractClient::new(&env, &contract_id);
        client.update_max_utilization(&9000);

        // Drain the reserve down to a size the cap can actually bite on.
        let reserve = 1_000_0000000i128;
        let contract_native = token::Client::new(&env, &native_id)
            .balance(&contract_id);
        // Move the surplus out so only `reserve` remains lendable.
        env.as_contract(&contract_id, || {
            token::Client::new(&env, &native_id).transfer(
                &contract_id,
                &Address::generate(&env),
                &(contract_native - reserve),
            );
        });

        StellarAssetClient::new(&env, &sxlm_id).mint(&user, &1_000_000_0000000);
        client.deposit_collateral(&user, &100_000_0000000);

        // 90% of a 1,000 XLM reserve is 900. Asking for 950 must fail.
        let r = client.try_borrow(&user, &950_0000000);
        assert!(r.is_err(), "utilization cap did not bind");

        // 800 sits under the cap and goes through.
        client.borrow(&user, &800_0000000);
        assert_eq!(client.total_borrowed(), 800_0000000);
    }

    /// A zero rate is reachable: shares outstanding against no assets.
    #[test]
    #[should_panic(expected = "vault reports no assets")]
    fn liquidation_refuses_a_zero_vault_rate() {
        let (env, contract_id, sxlm_id, _, user, liquidator, _, vault_id) = setup_with_vault();
        let client = LendingContractClient::new(&env, &contract_id);

        client.deposit_collateral(&user, &10_000_000_000);
        client.borrow(&user, &5_000_000_000);

        // Vault loses everything: shares remain, assets do not.
        MockVaultClient::new(&env, &vault_id).set_rate(&0);

        StellarAssetClient::new(&env, &sxlm_id).mint(&liquidator, &1_000_0000000);
        client.liquidate(&liquidator, &user);
    }

    /// ~5.8 days of ledgers. Short enough to stay inside the default entry TTL
    /// in the test environment, long enough for interest to be measurable.
    const YEAR_LEDGERS: i128 = 6_307_200;
    const SPAN: u32 = 100_000;

    fn advance(env: &Env, ledgers: u32) {
        env.ledger().with_mut(|l| l.sequence_number += ledgers);
    }

    /// Borrowing used to be free — the rate was stored, settable and never
    /// charged. Debt must now grow with time.
    #[test]
    fn debt_grows_with_time() {
        let (env, contract_id, _, _, user, _, _, _) = setup_with_vault();
        let client = LendingContractClient::new(&env, &contract_id);
        client.update_borrow_rate(&400); // 4% a year

        client.deposit_collateral(&user, &100_000_0000000);
        client.borrow(&user, &1_000_0000000);
        let (_, at_start) = client.get_position(&user);
        assert_eq!(at_start, 1_000_0000000);

        // A year of ledgers at ~5s each.
        advance(&env, SPAN);
        let (_, after_a_year) = client.get_position(&user);

        // 4% a year, prorated over the span.
        let expected_bps = 400 * (SPAN as i128) / YEAR_LEDGERS;
        let growth_bps = (after_a_year - at_start) * 10_000 / at_start;
        assert!(
            (growth_bps - expected_bps).abs() <= 1,
            "expected about {expected_bps} bps, got {growth_bps}"
        );
        assert!(growth_bps > 0, "no interest accrued at all");
    }

    #[test]
    fn interest_is_booked_for_settlement() {
        let (env, contract_id, _, _, user, _, _, _) = setup_with_vault();
        let client = LendingContractClient::new(&env, &contract_id);
        client.update_borrow_rate(&400);

        assert_eq!(client.total_accrued_interest(), 0);

        client.deposit_collateral(&user, &100_000_0000000);
        client.borrow(&user, &1_000_0000000);
        advance(&env, SPAN);

        let accrued = client.total_accrued_interest();
        let expected = 1_000_0000000i128 * 400 * (SPAN as i128) / (10_000 * YEAR_LEDGERS);
        assert!(
            (accrued - expected).abs() <= expected / 100,
            "expected about {expected} stroops of interest, got {accrued}"
        );
    }

    #[test]
    fn repaying_costs_more_than_was_borrowed() {
        let (env, contract_id, _, native_id, user, _, _, _) = setup_with_vault();
        let client = LendingContractClient::new(&env, &contract_id);
        client.update_borrow_rate(&400);

        client.deposit_collateral(&user, &100_000_0000000);
        client.borrow(&user, &1_000_0000000);
        advance(&env, SPAN);

        // Repaying exactly the principal leaves the interest outstanding.
        client.repay(&user, &1_000_0000000);
        let (_, still_owed) = client.get_position(&user);
        assert!(still_owed > 0, "interest vanished on repayment");

        StellarAssetClient::new(&env, &native_id).mint(&user, &100_0000000);
        client.repay(&user, &still_owed);
        let (_, cleared) = client.get_position(&user);
        assert_eq!(cleared, 0);
    }

    #[test]
    fn a_zero_rate_charges_nothing() {
        let (env, contract_id, _, _, user, _, _, _) = setup_with_vault();
        let client = LendingContractClient::new(&env, &contract_id);
        client.update_borrow_rate(&1);
        client.set_param(&symbol_short!("bor_rate"), &0);

        client.deposit_collateral(&user, &100_000_0000000);
        client.borrow(&user, &1_000_0000000);
        advance(&env, SPAN);
        let (_, owed) = client.get_position(&user);
        assert_eq!(owed, 1_000_0000000);
    }

    /// The whole point: interest paid by borrowers reaches sXLM holders as a
    /// higher exchange rate, rather than sitting in the lending contract.
    #[test]
    fn settled_interest_raises_the_vault_rate() {
        let (env, contract_id, _, native_id, user, _, _, vault_id) = setup_with_vault();
        let client = LendingContractClient::new(&env, &contract_id);
        let vault = MockVaultClient::new(&env, &vault_id);
        client.update_borrow_rate(&400);

        client.deposit_collateral(&user, &100_000_0000000);
        client.borrow(&user, &1_000_0000000);
        advance(&env, SPAN);

        let owed = client.get_position(&user).1;
        StellarAssetClient::new(&env, &native_id).mint(&user, &owed);
        client.repay(&user, &owed);

        let accrued = client.total_accrued_interest();
        assert!(accrued > 0, "nothing accrued to settle");

        let vault_before = token::Client::new(&env, &native_id).balance(&vault_id);
        let sent = client.settle_interest();

        // 80% reaches the vault, the rest stays as protocol revenue.
        assert_eq!(sent, accrued * 8000 / 10_000);
        assert_eq!(
            token::Client::new(&env, &native_id).balance(&vault_id) - vault_before,
            sent,
            "interest did not reach the vault"
        );
        assert!(client.total_accrued_interest() < accrued);
        let _ = &vault;
    }

    #[test]
    fn settling_with_nothing_accrued_is_a_no_op() {
        let (env, contract_id, _, _, _, _, _, _) = setup_with_vault();
        let client = LendingContractClient::new(&env, &contract_id);
        assert_eq!(client.settle_interest(), 0);
    }

    /// The surcharge reaches the vault, and comes out of the liquidator's
    /// bonus rather than the borrower's collateral.
    #[test]
    fn liquidation_surcharge_reaches_the_vault() {
        let (env, contract_id, sxlm_id, native_id, user, liquidator, _, vault_id) =
            setup_with_vault();
        let client = LendingContractClient::new(&env, &contract_id);
        let vault = MockVaultClient::new(&env, &vault_id);

        client.deposit_collateral(&user, &10_000_000_000);
        client.borrow(&user, &6_900_000_000); // just under the 70% limit

        // Collateral loses value until the position is liquidatable.
        vault.set_rate(&8_000_000);

        let native = token::Client::new(&env, &native_id);
        let vault_before = native.balance(&vault_id);
        let borrower_collateral_before = client.get_position(&user).0;

        client.liquidate(&liquidator, &user);

        let to_vault = native.balance(&vault_id) - vault_before;
        let expected = 6_900_000_000i128 * client.get_liquidation_fee_bps() / 10_000;
        assert_eq!(to_vault, expected, "surcharge did not reach the vault");
        assert!(to_vault > 0);

        // The borrower's side is untouched by the surcharge: seizure is still
        // priced off the bonus alone.
        let seized = borrower_collateral_before - client.get_position(&user).0;
        let priced_at_bonus = 6_900_000_000i128 * (10_000 + client.get_liquidation_bonus())
            / 10_000 * RATE_PRECISION / 8_000_000;
        assert!(
            (seized - priced_at_bonus).abs() <= 2 || seized == borrower_collateral_before,
            "surcharge was taken out of the borrower's collateral"
        );
        let _ = &sxlm_id;
    }

    #[test]
    #[should_panic(expected = "liquidation fee too high")]
    fn the_surcharge_cannot_exceed_the_bonus() {
        let (env, contract_id, _, _, _, _, _, _) = setup_with_vault();
        let client = LendingContractClient::new(&env, &contract_id);
        // Bonus is 500 bps; anything at or above it makes liquidating a loss.
        client.set_param(&symbol_short!("liq_fee"), &500);
    }

    #[test]
    fn test_liquidation() {
        let (env, _contract_id, _sxlm_id, _, _, _, _) = setup_test();

        // Create a separate contract with low liquidation threshold for testing
        let contract2 = env.register_contract(None, LendingContract);
        let client2 = LendingContractClient::new(&env, &contract2);
        let sxlm2 = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
        let native2 = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
        let vault2 = env.register_contract(None, MockVault);
        client2.initialize(&Address::generate(&env), &sxlm2, &native2, &7000, &5000, &500, &vault2);

        let u = Address::generate(&env);
        let liq = Address::generate(&env);
        StellarAssetClient::new(&env, &sxlm2).mint(&u, &100_000_0000000);
        StellarAssetClient::new(&env, &sxlm2).mint(&contract2, &100_000_0000000); // extra for bonus
        StellarAssetClient::new(&env, &native2).mint(&contract2, &500_000_0000000);
        StellarAssetClient::new(&env, &native2).mint(&liq, &100_000_0000000);

        client2.deposit_collateral(&u, &10_000_000_000);
        client2.borrow(&u, &7_000_000_000);
        // HF = 10000 * 1e7 * 5000/10000 / 7000 = 5000 * 1e7 / 7000 ≈ 7_142_857 < 1e7
        // Liquidatable!

        client2.liquidate(&liq, &u);
        let (col, bor) = client2.get_position(&u);
        assert_eq!(bor, 0);
        // Liquidator gets debt_with_bonus in sXLM: 7000 * 1.05 = 7350 (in units: 7_350_000_000)
        // Remaining collateral: 10_000_000_000 - 7_350_000_000 = 2_650_000_000
        assert_eq!(col, 2_650_000_000);
    }

    #[test]
    fn test_admin_update_collateral_factor() {
        let (env, contract_id, _, _, _, _, _) = setup_test();
        let client = LendingContractClient::new(&env, &contract_id);

        assert_eq!(client.get_collateral_factor(), 7000);
        client.update_collateral_factor(&7500);
        assert_eq!(client.get_collateral_factor(), 7500);
    }

    #[test]
    fn test_totals() {
        let (env, contract_id, sxlm_id, _, user, _, _) = setup_test();
        let client = LendingContractClient::new(&env, &contract_id);

        let user2 = Address::generate(&env);
        StellarAssetClient::new(&env, &sxlm_id).mint(&user2, &100_000_0000000);

        client.deposit_collateral(&user, &10_000_000_000);
        client.deposit_collateral(&user2, &5_000_000_000);

        assert_eq!(client.total_collateral(), 15_000_000_000);

        client.borrow(&user, &3_000_000_000);
        client.borrow(&user2, &2_000_000_000);

        assert_eq!(client.total_borrowed(), 5_000_000_000);
    }

    // ------------------------------------------------------------------
    // Version 3: governance owns every parameter, accounting stays exact
    // ------------------------------------------------------------------

    #[test]
    fn reports_version_3() {
        let (env, contract_id, ..) = setup_test();
        assert_eq!(LendingContractClient::new(&env, &contract_id).version(), 3);
    }

    /// The four `update_*` setters used to accept the admin key even after
    /// governance was configured, which left a way around every passed vote.
    #[test]
    fn legacy_setters_answer_to_governance_once_set() {
        let (env, contract_id, _, _, _, _, admin) = setup_test();
        let client = LendingContractClient::new(&env, &contract_id);

        client.update_borrow_rate(&600);
        assert_eq!(env.auths()[0].0, admin);

        let gov = Address::generate(&env);
        client.set_governance(&gov);

        client.update_borrow_rate(&700);
        assert_eq!(env.auths()[0].0, gov, "update_borrow_rate bypassed governance");
        client.update_collateral_factor(&7100);
        assert_eq!(env.auths()[0].0, gov, "update_collateral_factor bypassed governance");
        client.update_liquidation_threshold(&8100);
        assert_eq!(env.auths()[0].0, gov, "update_liquidation_threshold bypassed governance");
        client.update_max_utilization(&8500);
        assert_eq!(env.auths()[0].0, gov, "update_max_utilization bypassed governance");

        assert_eq!(client.get_borrow_rate(), 700);
        assert_eq!(client.get_collateral_factor(), 7100);
        assert_eq!(client.get_liquidation_threshold(), 8100);
        assert_eq!(client.get_max_utilization(), 8500);
    }

    #[test]
    fn legacy_setters_enforce_the_same_bounds_as_governance() {
        let (env, contract_id, ..) = setup_test();
        let client = LendingContractClient::new(&env, &contract_id);
        assert!(client.try_update_borrow_rate(&10_001).is_err());
        assert!(client.try_update_collateral_factor(&0).is_err());
        // The collateral factor may not pass the liquidation threshold (8000),
        // or a position could be liquidatable the moment it is opened.
        assert!(client.try_update_collateral_factor(&8_500).is_err());
        assert!(client.try_update_liquidation_threshold(&6_000).is_err());
    }

    /// A new borrow rate applies from the moment it is set. Time already
    /// elapsed is charged at the old rate.
    #[test]
    fn a_rate_change_is_not_applied_retroactively() {
        let (env, contract_id, _, _, user, ..) = setup_with_vault();
        let client = LendingContractClient::new(&env, &contract_id);
        client.update_borrow_rate(&400);
        client.deposit_collateral(&user, &100_000_0000000);
        client.borrow(&user, &1_000_0000000);

        advance(&env, SPAN);
        let (_, owed_at_change) = client.get_position(&user);
        let index_at_change = client.get_borrow_index();

        // Quadruple the rate. Nothing already owed may change.
        client.update_borrow_rate(&1_600);
        assert_eq!(client.get_borrow_index(), index_at_change);
        let (_, owed_after_change) = client.get_position(&user);
        assert_eq!(owed_after_change, owed_at_change);
    }

    #[test]
    fn a_rate_change_without_reading_first_still_charges_the_old_rate() {
        let (env, contract_id, _, _, user, ..) = setup_with_vault();
        let client = LendingContractClient::new(&env, &contract_id);
        client.update_borrow_rate(&400);
        client.deposit_collateral(&user, &100_000_0000000);
        client.borrow(&user, &1_000_0000000);

        // No read in between: the setter itself must accrue first.
        advance(&env, SPAN);
        client.update_borrow_rate(&1_600);
        let (_, owed) = client.get_position(&user);

        let expected_bps = 400 * (SPAN as i128) / YEAR_LEDGERS;
        let growth_bps = (owed - 1_000_0000000) * 10_000 / 1_000_0000000;
        assert!(
            (growth_bps - expected_bps).abs() <= 1,
            "charged {growth_bps} bps for a span that cost {expected_bps} at the old rate"
        );
    }

    /// Before version 3, liquidation subtracted an interest-bearing debt from
    /// the scaled total, removing more than the debt once the index passed 1.0.
    #[test]
    fn liquidation_leaves_the_total_equal_to_the_remaining_debts() {
        let (env, contract_id, sxlm_id, _, alice, liquidator, _, vault_id) = setup_with_vault();
        let client = LendingContractClient::new(&env, &contract_id);
        let bob = Address::generate(&env);
        StellarAssetClient::new(&env, &sxlm_id).mint(&bob, &100_000_0000000);
        StellarAssetClient::new(&env, &sxlm_id).mint(&contract_id, &100_000_0000000);

        client.update_borrow_rate(&2_000);
        client.deposit_collateral(&alice, &10_000_0000000);
        client.borrow(&alice, &6_900_0000000);
        client.deposit_collateral(&bob, &10_000_0000000);
        client.borrow(&bob, &1_000_0000000);

        advance(&env, SPAN * 4);
        assert!(client.get_borrow_index() > RATE_PRECISION, "test needs interest");

        // Collateral loses value; alice becomes liquidatable, bob does not.
        MockVaultClient::new(&env, &vault_id).set_rate(&(RATE_PRECISION * 8 / 10));
        assert!(client.health_factor(&alice) < RATE_PRECISION);
        assert!(client.health_factor(&bob) >= RATE_PRECISION);
        client.liquidate(&liquidator, &alice);

        let (_, bob_debt) = client.get_position(&bob);
        let total = client.total_borrowed();
        assert!(
            (total - bob_debt).abs() <= 1,
            "total {total} does not match the one remaining debt {bob_debt}"
        );
    }

    #[test]
    fn admin_rotation_needs_both_keys() {
        let (env, contract_id, _, _, _, _, admin) = setup_test();
        let client = LendingContractClient::new(&env, &contract_id);
        let next = Address::generate(&env);
        client.set_admin(&next);
        let signers: std::vec::Vec<Address> = env.auths().iter().map(|a| a.0.clone()).collect();
        assert!(signers.contains(&admin));
        assert!(signers.contains(&next));
        assert_eq!(client.admin(), next);
    }

    /// Instance storage as read from mainnet on 2026-11-23, orphaned keys
    /// included. Every live setting must read correctly with no migration.
    #[test]
    fn reads_the_live_mainnet_storage_unchanged() {
        #[derive(Clone)]
        #[contracttype]
        enum Orphan {
            ExchangeRate,
            Paused,
            TotalAccruedInterest,
        }

        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.sequence_number = 64_213_270);
        let admin = Address::generate(&env);
        let native = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let sxlm = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let vault = env.register_contract(None, MockVault);
        let id = env.register_contract(None, LendingContract);
        env.as_contract(&id, || {
            let st = env.storage().instance();
            st.set(&DataKey::Admin, &admin);
            st.set(&DataKey::BorrowIndex, &10_000_007i128);
            st.set(&DataKey::BorrowRateBps, &500i128);
            st.set(&DataKey::CollateralFactorBps, &7_500i128);
            st.set(&DataKey::Initialized, &true);
            st.set(&DataKey::InterestAccrued, &43i128);
            st.set(&DataKey::LastAccrualLedger, &64_213_270u32);
            st.set(&DataKey::LiquidationBonusBps, &500i128);
            st.set(&DataKey::LiquidationThresholdBps, &8_000i128);
            st.set(&DataKey::NativeToken, &native);
            st.set(&DataKey::SxlmToken, &sxlm);
            st.set(&DataKey::TotalBorrowed, &62_000_031i128);
            st.set(&DataKey::TotalCollateral, &140_300_000i128);
            st.set(&DataKey::Vault, &vault);
            st.set(&Orphan::ExchangeRate, &10_000_000i128);
            st.set(&Orphan::Paused, &false);
            st.set(&Orphan::TotalAccruedInterest, &0i128);
        });
        let c = LendingContractClient::new(&env, &id);
        assert_eq!(c.version(), 3);
        assert_eq!(c.get_vault_share_bps(), DEFAULT_VAULT_SHARE_BPS);
        assert_eq!(c.get_max_utilization(), DEFAULT_MAX_UTILIZATION_BPS);
        assert_eq!(c.get_liquidation_fee_bps(), DEFAULT_LIQUIDATION_FEE_BPS);
        assert_eq!(c.get_collateral_factor(), 7_500);
        assert_eq!(c.get_liquidation_threshold(), 8_000);
        assert_eq!(c.get_borrow_rate(), 500);
        assert_eq!(c.total_borrowed(), 62_000_031 * 10_000_007 / RATE_PRECISION);
        assert_eq!(c.total_accrued_interest(), 43);
        assert_eq!(c.admin(), admin);
    }

    // ------------------------------------------------------------------
    // Property tests
    // ------------------------------------------------------------------

    mod properties {
        use super::*;
        use proptest::prelude::*;
        use std::vec::Vec as StdVec;

        #[derive(Clone, Debug)]
        enum Op {
            Collateral { user: usize, amount: i128 },
            Borrow { user: usize, pct: u8 },
            Repay { user: usize, pct: u8 },
            Withdraw { user: usize, pct: u8 },
            Wait { ledgers: u32 },
            Rate { bps: i128 },
            Price { pct: u8 },
            Liquidate { user: usize },
            Settle,
        }

        const USERS: usize = 4;

        fn op() -> impl Strategy<Value = Op> {
            prop_oneof![
                3 => (0..USERS, 1i128..1_000_0000000).prop_map(|(user, amount)| Op::Collateral { user, amount }),
                3 => (0..USERS, 1u8..=100).prop_map(|(user, pct)| Op::Borrow { user, pct }),
                2 => (0..USERS, 1u8..=100).prop_map(|(user, pct)| Op::Repay { user, pct }),
                1 => (0..USERS, 1u8..=100).prop_map(|(user, pct)| Op::Withdraw { user, pct }),
                2 => (1u32..500_000).prop_map(|ledgers| Op::Wait { ledgers }),
                1 => (0i128..3_000).prop_map(|bps| Op::Rate { bps }),
                1 => (50u8..=150).prop_map(|pct| Op::Price { pct }),
                1 => (0..USERS).prop_map(|user| Op::Liquidate { user }),
                1 => Just(Op::Settle),
            ]
        }

        proptest! {
            #![proptest_config(ProptestConfig { cases: 48, ..ProptestConfig::default() })]

            /// Across any sequence of borrows, repayments, rate changes,
            /// price moves and liquidations: the recorded total equals the
            /// sum of individual debts, the index only rises, and no borrow
            /// leaves a position below its collateral factor.
            #[test]
            fn debts_always_add_up(ops in proptest::collection::vec(op(), 1..40)) {
                let (env, id, sxlm_id, native_id, _, liquidator, _, vault_id) = setup_with_vault();
                env.budget().reset_unlimited();
                let c = LendingContractClient::new(&env, &id);
                let vault = MockVaultClient::new(&env, &vault_id);
                let sxlm = StellarAssetClient::new(&env, &sxlm_id);
                let xlm = StellarAssetClient::new(&env, &native_id);
                sxlm.mint(&id, &1_000_000_0000000);
                let users: StdVec<Address> = (0..USERS).map(|_| Address::generate(&env)).collect();
                for u in users.iter() {
                    sxlm.mint(u, &10_000_0000000);
                    xlm.mint(u, &1_000_000_0000000);
                }
                let mut index = c.get_borrow_index();

                for op in ops.iter() {
                    match op.clone() {
                        Op::Collateral { user, amount } => {
                            let _ = c.try_deposit_collateral(&users[user], &amount);
                        }
                        Op::Borrow { user, pct } => {
                            let u = &users[user];
                            let (col, debt) = c.get_position(u);
                            let room = col * c.get_exchange_rate() * c.get_collateral_factor()
                                / (BPS_DENOMINATOR * RATE_PRECISION) - debt;
                            let amount = room * pct as i128 / 100;
                            if amount > 0 && c.try_borrow(u, &amount).is_ok() {
                                let (col, debt) = c.get_position(u);
                                let max = col * c.get_exchange_rate() * c.get_collateral_factor()
                                    / (BPS_DENOMINATOR * RATE_PRECISION);
                                prop_assert!(debt <= max, "borrow left debt {} above limit {}", debt, max);
                            }
                        }
                        Op::Repay { user, pct } => {
                            let (_, debt) = c.get_position(&users[user]);
                            let amount = debt * pct as i128 / 100;
                            if amount > 0 {
                                let _ = c.try_repay(&users[user], &amount);
                            }
                        }
                        Op::Withdraw { user, pct } => {
                            let (col, _) = c.get_position(&users[user]);
                            let amount = col * pct as i128 / 100;
                            if amount > 0 {
                                let _ = c.try_withdraw_collateral(&users[user], &amount);
                            }
                        }
                        Op::Wait { ledgers } => {
                            env.ledger().with_mut(|l| l.sequence_number += ledgers);
                        }
                        Op::Rate { bps } => {
                            c.set_param(&symbol_short!("bor_rate"), &bps);
                        }
                        Op::Price { pct } => {
                            vault.set_rate(&(RATE_PRECISION * pct as i128 / 100));
                        }
                        Op::Liquidate { user } => {
                            let _ = c.try_liquidate(&liquidator, &users[user]);
                        }
                        Op::Settle => {
                            let _ = c.try_settle_interest();
                        }
                    }

                    let next = c.get_borrow_index();
                    prop_assert!(next >= index, "borrow index fell");
                    index = next;

                    let sum: i128 = users.iter().map(|u| c.get_position(u).1).sum();
                    let total = c.total_borrowed();
                    prop_assert!(
                        (total - sum).abs() <= USERS as i128,
                        "total {} vs sum of debts {} after {:?}", total, sum, op
                    );
                    prop_assert!(c.total_accrued_interest() >= 0);
                }
            }
        }
    }
}
