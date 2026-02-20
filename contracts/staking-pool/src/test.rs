#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token, Address, Env, String,
};

// Mock token contract for testing
mod mock_token {
    use soroban_sdk::{contract, contractimpl, Address, Env};

    #[contract]
    pub struct MockToken;

    #[contractimpl]
    impl MockToken {
        pub fn initialize(
            _env: Env,
            _admin: Address,
            _decimal: u32,
            _name: String,
            _symbol: String,
        ) {
        }

        pub fn mint(_env: Env, _to: Address, _amount: i128) {}

        pub fn burn(_env: Env, _from: Address, _amount: i128) {}

        pub fn balance(_env: Env, _id: Address) -> i128 {
            1000_0000000 // Return sufficient balance for tests
        }

        pub fn total_supply(_env: Env) -> i128 {
            1000_0000000
        }

        pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {}
    }
}

// Mock validator manager for testing
mod mock_validator_manager {
    use soroban_sdk::{contract, contractimpl, Address, Env};

    #[contract]
    pub struct MockValidatorManager;

    #[contractimpl]
    impl MockValidatorManager {
        pub fn initialize(_env: Env, _admin: Address, _staking_pool: Address) {}
        
        pub fn allocate_stake(_env: Env, _amount: i128) {}
    }
}

// Mock withdrawal queue for testing
mod mock_withdrawal_queue {
    use soroban_sdk::{contract, contractimpl, Address, Env};

    #[contract]
    pub struct MockWithdrawalQueue;

    #[contractimpl]
    impl MockWithdrawalQueue {
        pub fn initialize(_env: Env, _admin: Address, _staking_pool: Address) {}
        
        pub fn enqueue(_env: Env, _user: Address, _xlm_amount: i128) -> u64 {
            1 // Return mock request ID
        }
    }
}

// Test helper to create initialized staking pool
fn create_staking_pool<'a>(env: &Env) -> (
    Address,
    Address,
    Address,
    Address,
    Address,
    StakingPoolClient<'a>,
) {
    let admin = Address::generate(env);
    
    // Deploy mock contracts
    let sxlm_token_addr = env.register_contract_wasm(None, mock_token::WASM);
    let validator_mgr_addr = env.register_contract_wasm(None, mock_validator_manager::WASM);
    let withdrawal_queue_addr = env.register_contract_wasm(None, mock_withdrawal_queue::WASM);
    
    // Deploy staking pool
    let staking_pool_addr = env.register_contract(None, StakingPool);
    let staking_pool = StakingPoolClient::new(env, &staking_pool_addr);

    // Initialize staking pool
    staking_pool.initialize(
        &admin,
        &sxlm_token_addr,
        &validator_mgr_addr,
        &withdrawal_queue_addr,
    );

    (
        admin,
        sxlm_token_addr,
        validator_mgr_addr,
        withdrawal_queue_addr,
        staking_pool_addr,
        staking_pool,
    )
}

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sxlm_token = Address::generate(&env);
    let validator_mgr = Address::generate(&env);
    let withdrawal_queue = Address::generate(&env);

    let staking_pool_addr = env.register_contract(None, StakingPool);
    let staking_pool = StakingPoolClient::new(&env, &staking_pool_addr);

    // Test initialization
    staking_pool.initialize(&admin, &sxlm_token, &validator_mgr, &withdrawal_queue);

    // Verify initial state
    assert_eq!(staking_pool.get_total_staked(), 0);
    assert_eq!(staking_pool.get_exchange_rate(), 10_000_000); // 1.0 initial rate

    println!("✓ Test: Initialize contract");
}

#[test]
#[should_panic(expected = "AlreadyInitialized")]
fn test_initialize_twice() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, sxlm_token, validator_mgr, withdrawal_queue, _, staking_pool) = 
        create_staking_pool(&env);

    // Try to initialize again - should panic
    staking_pool.initialize(&admin, &sxlm_token, &validator_mgr, &withdrawal_queue);
}

#[test]
fn test_deposit_initial() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, _, _, _, _, staking_pool) = create_staking_pool(&env);
    let user = Address::generate(&env);

    // First deposit - should get 1:1 ratio
    let deposit_amount: i128 = 1000_0000000; // 1000 XLM
    let sxlm_received = staking_pool.deposit(&user, &deposit_amount);

    assert_eq!(sxlm_received, deposit_amount);
    assert_eq!(staking_pool.get_total_staked(), deposit_amount);
    assert_eq!(staking_pool.get_exchange_rate(), 10_000_000); // Still 1.0

    println!("✓ Test: Initial deposit (1:1 ratio)");
    println!("  Deposited: {} XLM", deposit_amount / 10_000_000);
    println!("  Received: {} sXLM", sxlm_received / 10_000_000);
}

#[test]
fn test_exchange_rate_calculation() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, _, _, _, _, staking_pool) = create_staking_pool(&env);
    let user = Address::generate(&env);

    // Initial deposit
    let deposit_amount: i128 = 1000_0000000; // 1000 XLM
    staking_pool.deposit(&user, &deposit_amount);

    // Simulate rewards
    let rewards: i128 = 50_0000000; // 50 XLM (5% return)
    staking_pool.accrue_rewards(&rewards);

    // Check exchange rate
    let exchange_rate = staking_pool.get_exchange_rate();
    let expected_rate = ((deposit_amount + rewards) * 10_000_000) / deposit_amount;
    
    assert_eq!(exchange_rate, expected_rate);
    assert_eq!(exchange_rate, 10_500_000); // 1.05

    println!("✓ Test: Exchange rate after rewards");
    println!("  Initial stake: {} XLM", deposit_amount / 10_000_000);
    println!("  Rewards: {} XLM", rewards / 10_000_000);
    println!("  Exchange rate: {}", exchange_rate as f64 / 10_000_000.0);
}

#[test]
fn test_deposit_after_rewards() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, _, _, _, _, staking_pool) = create_staking_pool(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    // User1 deposits
    let deposit1: i128 = 1000_0000000;
    let sxlm1 = staking_pool.deposit(&user1, &deposit1);

    // Accrue rewards
    let rewards: i128 = 50_0000000; // 5% return
    staking_pool.accrue_rewards(&rewards);

    // User2 deposits same amount
    let deposit2: i128 = 1000_0000000;
    let sxlm2 = staking_pool.deposit(&user2, &deposit2);

    // User2 should receive less sXLM due to higher exchange rate
    assert!(sxlm2 < sxlm1);
    
    // Calculate expected sXLM for user2
    let exchange_rate = staking_pool.get_exchange_rate();
    let expected_sxlm2 = (deposit2 * 10_000_000) / exchange_rate;
    
    assert_eq!(sxlm2, expected_sxlm2);
    assert_eq!(sxlm2, 952_3809523); // ~952.38 sXLM at 1.05 rate

    println!("✓ Test: Deposit after rewards accrual");
    println!("  User1 deposited {} XLM → {} sXLM (at 1.0 rate)", 
             deposit1 / 10_000_000, sxlm1 / 10_000_000);
    println!("  User2 deposited {} XLM → {} sXLM (at 1.05 rate)", 
             deposit2 / 10_000_000, sxlm2 / 10_000_000);
}

#[test]
fn test_withdrawal_calculation() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, _, _, _, _, staking_pool) = create_staking_pool(&env);
    let user = Address::generate(&env);

    // Deposit
    let deposit: i128 = 1000_0000000;
    let sxlm = staking_pool.deposit(&user, &deposit);

    // Accrue rewards
    let rewards: i128 = 100_0000000; // 10% return
    staking_pool.accrue_rewards(&rewards);

    // User should be able to withdraw more XLM than deposited
    let exchange_rate = staking_pool.get_exchange_rate();
    let xlm_value = (sxlm * exchange_rate) / 10_000_000;
    
    assert_eq!(xlm_value, 1100_0000000); // 1100 XLM (100 profit)
    assert_eq!(exchange_rate, 11_000_000); // 1.1 rate

    println!("✓ Test: Withdrawal value calculation");
    println!("  Initial deposit: {} XLM", deposit / 10_000_000);
    println!("  sXLM balance: {} sXLM", sxlm / 10_000_000);
    println!("  Current value: {} XLM", xlm_value / 10_000_000);
    println!("  Profit: {} XLM", (xlm_value - deposit) / 10_000_000);
}

#[test]
fn test_multiple_deposits_and_rewards() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, _, _, _, _, staking_pool) = create_staking_pool(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);

    // Phase 1: User1 deposits
    let d1: i128 = 1000_0000000;
    let sxlm1 = staking_pool.deposit(&user1, &d1);
    
    // Phase 2: Rewards accrue
    staking_pool.accrue_rewards(&50_0000000); // 5%
    
    // Phase 3: User2 deposits
    let d2: i128 = 2000_0000000;
    let sxlm2 = staking_pool.deposit(&user2, &d2);
    
    // Phase 4: More rewards
    staking_pool.accrue_rewards(&150_0000000); // More rewards
    
    // Phase 5: User3 deposits
    let d3: i128 = 500_0000000;
    let sxlm3 = staking_pool.deposit(&user3, &d3);

    // Verify total staked
    let total = staking_pool.get_total_staked();
    assert_eq!(total, d1 + d2 + d3 + 50_0000000 + 150_0000000);

    // Each user's sXLM should reflect the exchange rate at time of deposit
    assert!(sxlm1 > sxlm2 / 2); // User1 got better rate
    assert!(sxlm2 > sxlm3 * 4); // User2 got better rate than User3

    println!("✓ Test: Multiple users with staggered deposits");
    println!("  Total staked: {} XLM", total / 10_000_000);
    println!("  User1: {} sXLM", sxlm1 / 10_000_000);
    println!("  User2: {} sXLM", sxlm2 / 10_000_000);
    println!("  User3: {} sXLM", sxlm3 / 10_000_000);
}

#[test]
fn test_pause_unpause() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, _, _, _, _, staking_pool) = create_staking_pool(&env);
    let user = Address::generate(&env);

    // Pause the contract
    staking_pool.pause();

    // Try to deposit - should fail
    let result = std::panic::catch_unwind(|| {
        staking_pool.deposit(&user, &1000_0000000);
    });
    assert!(result.is_err());

    // Unpause
    staking_pool.unpause();

    // Now deposit should work
    let sxlm = staking_pool.deposit(&user, &1000_0000000);
    assert_eq!(sxlm, 1000_0000000);

    println!("✓ Test: Pause and unpause functionality");
}

#[test]
fn test_exchange_rate_never_decreases() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, _, _, _, _, staking_pool) = create_staking_pool(&env);
    let user = Address::generate(&env);

    // Initial deposit
    staking_pool.deposit(&user, &1000_0000000);
    let rate1 = staking_pool.get_exchange_rate();

    // Accrue rewards multiple times
    for i in 1..=5 {
        staking_pool.accrue_rewards(&10_0000000); // 10 XLM each time
        let rate_new = staking_pool.get_exchange_rate();
        
        // Rate should always increase or stay same
        assert!(rate_new >= rate1);
        
        println!("  Round {}: Rate = {}", i, rate_new as f64 / 10_000_000.0);
    }

    let final_rate = staking_pool.get_exchange_rate();
    assert!(final_rate > rate1);

    println!("✓ Test: Exchange rate never decreases");
    println!("  Initial rate: {}", rate1 as f64 / 10_000_000.0);
    println!("  Final rate: {}", final_rate as f64 / 10_000_000.0);
}

#[test]
fn test_zero_supply_edge_case() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, _, _, _, _, staking_pool) = create_staking_pool(&env);

    // With zero supply, exchange rate should be 1.0
    let rate = staking_pool.get_exchange_rate();
    assert_eq!(rate, 10_000_000);

    println!("✓ Test: Zero supply edge case handled");
}

#[test]
fn test_precision_no_loss() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, _, _, _, _, staking_pool) = create_staking_pool(&env);
    let user = Address::generate(&env);

    // Small deposits should not lose precision
    let small_deposit: i128 = 1_0000000; // 1 XLM
    let sxlm = staking_pool.deposit(&user, &small_deposit);
    
    assert_eq!(sxlm, small_deposit);

    println!("✓ Test: Precision maintained for small amounts");
}

#[test]
fn test_large_amounts() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, _, _, _, _, staking_pool) = create_staking_pool(&env);
    let user = Address::generate(&env);

    // Large deposit (1 million XLM)
    let large_deposit: i128 = 1_000_000_0000000;
    let sxlm = staking_pool.deposit(&user, &large_deposit);
    
    assert_eq!(sxlm, large_deposit);
    assert_eq!(staking_pool.get_total_staked(), large_deposit);

    println!("✓ Test: Large amounts handled correctly");
    println!("  Deposited: {} XLM", large_deposit / 10_000_000);
}

// Run all tests with: cargo test --package staking-pool