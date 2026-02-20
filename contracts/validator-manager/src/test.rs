#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    Address, Env,
};

fn create_validator_manager<'a>(env: &Env) -> (Address, Address, ValidatorManagerClient<'a>) {
    let admin = Address::generate(env);
    let staking_pool = Address::generate(env);
    
    let mgr_addr = env.register_contract(None, ValidatorManager);
    let mgr = ValidatorManagerClient::new(env, &mgr_addr);
    
    mgr.initialize(&admin, &staking_pool);
    
    (admin, staking_pool, mgr)
}

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, mgr) = create_validator_manager(&env);
    
    assert_eq!(mgr.get_total_allocated_amount(), 0);
    
    println!("✓ Test: Validator Manager initialized");
}

#[test]
fn test_add_validator() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, mgr) = create_validator_manager(&env);
    let validator_addr = Address::generate(&env);
    
    let validator = Validator {
        address: validator_addr.clone(),
        score: 95,
        commission: 500, // 5%
        uptime: 99,
        is_active: true,
    };
    
    mgr.add_validator(&validator);
    
    let validators = mgr.get_validators_list();
    assert_eq!(validators.len(), 1);
    assert_eq!(validators.get(0).unwrap().score, 95);
    
    println!("✓ Test: Validator added successfully");
}

#[test]
fn test_add_multiple_validators() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, mgr) = create_validator_manager(&env);
    
    // Add 3 validators
    for i in 0..3 {
        let validator = Validator {
            address: Address::generate(&env),
            score: 90 - (i * 5), // 90, 85, 80
            commission: 300,
            uptime: 98,
            is_active: true,
        };
        mgr.add_validator(&validator);
    }
    
    let validators = mgr.get_validators_list();
    assert_eq!(validators.len(), 3);
    
    println!("✓ Test: Multiple validators added");
}

#[test]
fn test_reject_low_score_validator() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, mgr) = create_validator_manager(&env);
    
    let bad_validator = Validator {
        address: Address::generate(&env),
        score: 60, // Below 70% minimum
        commission: 300,
        uptime: 60,
        is_active: true,
    };
    
    // Should fail
    let result = std::panic::catch_unwind(|| {
        mgr.add_validator(&bad_validator);
    });
    
    assert!(result.is_err());
    
    println!("✓ Test: Low score validator rejected");
}

#[test]
fn test_remove_validator() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, mgr) = create_validator_manager(&env);
    let validator_addr = Address::generate(&env);
    
    let validator = Validator {
        address: validator_addr.clone(),
        score: 90,
        commission: 300,
        uptime: 98,
        is_active: true,
    };
    
    mgr.add_validator(&validator);
    assert_eq!(mgr.get_validators_list().len(), 1);
    
    mgr.remove_validator(&validator_addr);
    assert_eq!(mgr.get_validators_list().len(), 0);
    
    println!("✓ Test: Validator removed");
}

#[test]
fn test_update_validator_score() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, mgr) = create_validator_manager(&env);
    let validator_addr = Address::generate(&env);
    
    let validator = Validator {
        address: validator_addr.clone(),
        score: 95,
        commission: 300,
        uptime: 99,
        is_active: true,
    };
    
    mgr.add_validator(&validator);
    
    // Update score
    mgr.update_validator_score(&validator_addr, &80);
    
    let validators = mgr.get_validators_list();
    assert_eq!(validators.get(0).unwrap().score, 80);
    
    println!("✓ Test: Validator score updated");
}

#[test]
fn test_allocate_stake_single_validator() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, staking_pool, mgr) = create_validator_manager(&env);
    let validator_addr = Address::generate(&env);
    
    let validator = Validator {
        address: validator_addr.clone(),
        score: 95,
        commission: 300,
        uptime: 99,
        is_active: true,
    };
    
    mgr.add_validator(&validator);
    
    // Allocate 1000 XLM
    let amount: i128 = 1000_0000000;
    mgr.allocate_stake(&amount);
    
    // All stake should go to the single validator
    let allocation = mgr.get_validator_allocation(&validator_addr);
    assert_eq!(allocation, amount);
    assert_eq!(mgr.get_total_allocated_amount(), amount);
    
    println!("✓ Test: Stake allocated to single validator");
}

#[test]
fn test_weighted_allocation() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, mgr) = create_validator_manager(&env);
    
    let val1_addr = Address::generate(&env);
    let val2_addr = Address::generate(&env);
    
    // Validator 1: Score 90
    mgr.add_validator(&Validator {
        address: val1_addr.clone(),
        score: 90,
        commission: 300,
        uptime: 99,
        is_active: true,
    });
    
    // Validator 2: Score 60 (below threshold, should be ignored)
    mgr.add_validator(&Validator {
        address: val2_addr.clone(),
        score: 80,
        commission: 300,
        uptime: 95,
        is_active: true,
    });
    
    // Allocate stake
    let amount: i128 = 1000_0000000;
    mgr.allocate_stake(&amount);
    
    let alloc1 = mgr.get_validator_allocation(&val1_addr);
    let alloc2 = mgr.get_validator_allocation(&val2_addr);
    
    // Validator 1 should get 90/170 of stake
    // Validator 2 should get 80/170 of stake
    let expected_alloc1 = (amount * 90) / 170;
    let expected_alloc2 = (amount * 80) / 170;
    
    assert_eq!(alloc1, expected_alloc1);
    assert_eq!(alloc2, expected_alloc2);
    
    println!("✓ Test: Weighted allocation based on scores");
    println!("  Val1 (90 score): {} XLM", alloc1 / 10_000_000);
    println!("  Val2 (80 score): {} XLM", alloc2 / 10_000_000);
}

#[test]
fn test_multiple_allocations() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, mgr) = create_validator_manager(&env);
    let validator_addr = Address::generate(&env);
    
    mgr.add_validator(&Validator {
        address: validator_addr.clone(),
        score: 90,
        commission: 300,
        uptime: 99,
        is_active: true,
    });
    
    // Multiple allocations
    mgr.allocate_stake(&500_0000000);
    mgr.allocate_stake(&300_0000000);
    mgr.allocate_stake(&200_0000000);
    
    let total = mgr.get_total_allocated_amount();
    assert_eq!(total, 1000_0000000);
    
    let allocation = mgr.get_validator_allocation(&validator_addr);
    assert_eq!(allocation, 1000_0000000);
    
    println!("✓ Test: Multiple allocations accumulate");
}

#[test]
fn test_max_validators_limit() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, mgr) = create_validator_manager(&env);
    
    // Add 20 validators (the maximum)
    for i in 0..20 {
        let validator = Validator {
            address: Address::generate(&env),
            score: 75,
            commission: 300,
            uptime: 95,
            is_active: true,
        };
        mgr.add_validator(&validator);
    }
    
    assert_eq!(mgr.get_validators_list().len(), 20);
    
    // Try to add one more - should fail
    let result = std::panic::catch_unwind(|| {
        mgr.add_validator(&Validator {
            address: Address::generate(&env),
            score: 90,
            commission: 300,
            uptime: 99,
            is_active: true,
        });
    });
    
    assert!(result.is_err());
    
    println!("✓ Test: Maximum validator limit enforced");
}

// Run with: cargo test --package validator-manager