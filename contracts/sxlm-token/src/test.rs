#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    Address, Env, String,
};

fn create_token<'a>(env: &Env) -> (Address, Address, SXLMTokenClient<'a>) {
    let admin = Address::generate(env);
    let minter = Address::generate(env);
    
    let token_addr = env.register_contract(None, SXLMToken);
    let token = SXLMTokenClient::new(env, &token_addr);
    
    token.initialize(
        &admin,
        &minter,
        &7,
        &String::from_str(env, "Staked XLM"),
        &String::from_str(env, "sXLM"),
    );
    
    (admin, minter, token)
}

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (admin, minter, token) = create_token(&env);
    
    assert_eq!(token.name(), String::from_str(&env, "Staked XLM"));
    assert_eq!(token.symbol(), String::from_str(&env, "sXLM"));
    assert_eq!(token.decimals(), 7);
    assert_eq!(token.total_supply(), 0);
    
    println!("✓ Test: Token initialized correctly");
}

#[test]
fn test_mint_by_authorized_minter() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, minter, token) = create_token(&env);
    let user = Address::generate(&env);
    
    let amount: i128 = 1000_0000000;
    token.mint(&user, &amount);
    
    assert_eq!(token.balance(&user), amount);
    assert_eq!(token.total_supply(), amount);
    
    println!("✓ Test: Minter can mint tokens");
}

#[test]
fn test_burn_by_authorized_minter() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, minter, token) = create_token(&env);
    let user = Address::generate(&env);
    
    // Mint first
    let amount: i128 = 1000_0000000;
    token.mint(&user, &amount);
    
    // Then burn
    let burn_amount: i128 = 300_0000000;
    token.burn(&user, &burn_amount);
    
    assert_eq!(token.balance(&user), amount - burn_amount);
    assert_eq!(token.total_supply(), amount - burn_amount);
    
    println!("✓ Test: Minter can burn tokens");
}

#[test]
fn test_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, token) = create_token(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    
    // Mint to user1
    token.mint(&user1, &1000_0000000);
    
    // Transfer to user2
    let transfer_amount: i128 = 300_0000000;
    token.transfer(&user1, &user2, &transfer_amount);
    
    assert_eq!(token.balance(&user1), 700_0000000);
    assert_eq!(token.balance(&user2), 300_0000000);
    
    println!("✓ Test: Token transfer works");
}

#[test]
fn test_multiple_mints() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, token) = create_token(&env);
    let user = Address::generate(&env);
    
    // Multiple mints
    token.mint(&user, &100_0000000);
    token.mint(&user, &200_0000000);
    token.mint(&user, &300_0000000);
    
    assert_eq!(token.balance(&user), 600_0000000);
    assert_eq!(token.total_supply(), 600_0000000);
    
    println!("✓ Test: Multiple mints accumulate correctly");
}

#[test]
fn test_supply_tracking() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, token) = create_token(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);
    
    // Mint to different users
    token.mint(&user1, &1000_0000000);
    token.mint(&user2, &2000_0000000);
    token.mint(&user3, &500_0000000);
    
    assert_eq!(token.total_supply(), 3500_0000000);
    
    // Burn from one user
    token.burn(&user1, &300_0000000);
    
    assert_eq!(token.total_supply(), 3200_0000000);
    
    println!("✓ Test: Total supply tracked correctly");
}

#[test]
fn test_get_minter_address() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, minter, token) = create_token(&env);
    
    assert_eq!(token.get_minter_address(), minter);
    
    println!("✓ Test: Can retrieve minter address");
}

#[test]
fn test_update_minter() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (admin, old_minter, token) = create_token(&env);
    let new_minter = Address::generate(&env);
    
    // Update minter
    token.set_new_minter(&new_minter);
    
    assert_eq!(token.get_minter_address(), new_minter);
    
    println!("✓ Test: Minter can be updated");
}

#[test]
fn test_zero_amount_mint() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, token) = create_token(&env);
    let user = Address::generate(&env);
    
    // Try to mint zero - should fail
    let result = std::panic::catch_unwind(|| {
        token.mint(&user, &0);
    });
    
    assert!(result.is_err());
    
    println!("✓ Test: Zero amount mint rejected");
}

#[test]
fn test_negative_amount_mint() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, token) = create_token(&env);
    let user = Address::generate(&env);
    
    // Try to mint negative - should fail
    let result = std::panic::catch_unwind(|| {
        token.mint(&user, &-100_0000000);
    });
    
    assert!(result.is_err());
    
    println!("✓ Test: Negative amount mint rejected");
}

#[test]
fn test_composability() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, token) = create_token(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let spender = Address::generate(&env);
    
    // Mint to user1
    token.mint(&user1, &1000_0000000);
    
    // Approve spender
    token.approve(&user1, &spender, &500_0000000, &1000);
    
    // Check allowance
    assert_eq!(token.allowance(&user1, &spender), 500_0000000);
    
    // Spender transfers on behalf of user1
    token.transfer_from(&spender, &user1, &user2, &300_0000000);
    
    assert_eq!(token.balance(&user1), 700_0000000);
    assert_eq!(token.balance(&user2), 300_0000000);
    
    println!("✓ Test: Token composability (approve/transferFrom)");
}

// Run with: cargo test --package sxlm-token