#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

fn create_withdrawal_queue<'a>(env: &Env) -> (Address, Address, WithdrawalQueueClient<'a>) {
    let admin = Address::generate(env);
    let staking_pool = Address::generate(env);
    
    let queue_addr = env.register_contract(None, WithdrawalQueue);
    let queue = WithdrawalQueueClient::new(env, &queue_addr);
    
    queue.initialize(&admin, &staking_pool);
    
    (admin, staking_pool, queue)
}

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, queue) = create_withdrawal_queue(&env);
    
    assert_eq!(queue.get_queue_size(), 0);
    
    println!("✓ Test: Withdrawal Queue initialized");
}

#[test]
fn test_enqueue_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, staking_pool, queue) = create_withdrawal_queue(&env);
    let user = Address::generate(&env);
    
    let amount: i128 = 1000_0000000;
    let request_id = queue.enqueue(&user, &amount);
    
    assert_eq!(request_id, 0); // First request
    assert_eq!(queue.get_queue_size(), 1);
    
    // Check request details
    let request = queue.get_request(&request_id).unwrap();
    assert_eq!(request.user, user);
    assert_eq!(request.xlm_amount, amount);
    assert_eq!(request.status, WithdrawalStatus::Pending);
    
    println!("✓ Test: Withdrawal enqueued");
}

#[test]
fn test_multiple_withdrawals() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, queue) = create_withdrawal_queue(&env);
    
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);
    
    queue.enqueue(&user1, &500_0000000);
    queue.enqueue(&user2, &1000_0000000);
    queue.enqueue(&user3, &750_0000000);
    
    assert_eq!(queue.get_queue_size(), 3);
    
    println!("✓ Test: Multiple withdrawals queued");
}

#[test]
fn test_mark_ready() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (admin, _, queue) = create_withdrawal_queue(&env);
    let user = Address::generate(&env);
    
    let request_id = queue.enqueue(&user, &1000_0000000);
    
    // Mark as ready
    queue.mark_ready(&request_id);
    
    let request = queue.get_request(&request_id).unwrap();
    assert_eq!(request.status, WithdrawalStatus::Ready);
    
    println!("✓ Test: Withdrawal marked as ready");
}

#[test]
fn test_claim_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();
    
    // Set initial timestamp
    env.ledger().set(LedgerInfo {
        timestamp: 1000000,
        protocol_version: 20,
        sequence_number: 10,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3110400,
    });
    
    let (_, _, queue) = create_withdrawal_queue(&env);
    let user = Address::generate(&env);
    
    let request_id = queue.enqueue(&user, &1000_0000000);
    
    // Mark as ready
    queue.mark_ready(&request_id);
    
    // Fast-forward time past unbonding period
    env.ledger().set(LedgerInfo {
        timestamp: 1000000 + 604800 + 1, // 7 days + 1 second
        protocol_version: 20,
        sequence_number: 11,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3110400,
    });
    
    // Claim withdrawal
    queue.claim(&request_id);
    
    let request = queue.get_request(&request_id).unwrap();
    assert_eq!(request.status, WithdrawalStatus::Claimed);
    
    println!("✓ Test: Withdrawal claimed successfully");
}

#[test]
fn test_claim_before_unlock_fails() {
    let env = Env::default();
    env.mock_all_auths();
    
    env.ledger().set(LedgerInfo {
        timestamp: 1000000,
        protocol_version: 20,
        sequence_number: 10,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3110400,
    });
    
    let (_, _, queue) = create_withdrawal_queue(&env);
    let user = Address::generate(&env);
    
    let request_id = queue.enqueue(&user, &1000_0000000);
    queue.mark_ready(&request_id);
    
    // Try to claim immediately - should fail
    let result = std::panic::catch_unwind(|| {
        queue.claim(&request_id);
    });
    
    assert!(result.is_err());
    
    println!("✓ Test: Cannot claim before unlock time");
}

#[test]
fn test_batch_mark_ready() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, queue) = create_withdrawal_queue(&env);
    
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);
    
    let id1 = queue.enqueue(&user1, &500_0000000);
    let id2 = queue.enqueue(&user2, &1000_0000000);
    let id3 = queue.enqueue(&user3, &750_0000000);
    
    // Batch mark ready
    let mut ids = Vec::new(&env);
    ids.push_back(id1);
    ids.push_back(id2);
    ids.push_back(id3);
    
    queue.batch_mark_ready(&ids);
    
    // Check all are ready
    assert_eq!(queue.get_request(&id1).unwrap().status, WithdrawalStatus::Ready);
    assert_eq!(queue.get_request(&id2).unwrap().status, WithdrawalStatus::Ready);
    assert_eq!(queue.get_request(&id3).unwrap().status, WithdrawalStatus::Ready);
    
    println!("✓ Test: Batch mark ready works");
}

#[test]
fn test_get_user_requests() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, queue) = create_withdrawal_queue(&env);
    let user = Address::generate(&env);
    let other_user = Address::generate(&env);
    
    // User makes 3 withdrawals
    queue.enqueue(&user, &100_0000000);
    queue.enqueue(&user, &200_0000000);
    queue.enqueue(&other_user, &300_0000000);
    queue.enqueue(&user, &150_0000000);
    
    let user_requests = queue.get_user_requests(&user);
    assert_eq!(user_requests.len(), 3);
    
    println!("✓ Test: Get user requests filters correctly");
}

#[test]
fn test_get_pending_requests() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, queue) = create_withdrawal_queue(&env);
    
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    
    let id1 = queue.enqueue(&user1, &500_0000000);
    let id2 = queue.enqueue(&user2, &1000_0000000);
    queue.enqueue(&user1, &750_0000000);
    
    // Mark one as ready
    queue.mark_ready(&id1);
    
    let pending = queue.get_pending_requests();
    assert_eq!(pending.len(), 2); // Only 2 still pending
    
    println!("✓ Test: Get pending requests excludes ready ones");
}

#[test]
fn test_cancel_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, queue) = create_withdrawal_queue(&env);
    let user = Address::generate(&env);
    
    let request_id = queue.enqueue(&user, &1000_0000000);
    
    // Cancel withdrawal
    queue.cancel_withdrawal(&request_id);
    
    let request = queue.get_request(&request_id).unwrap();
    assert_eq!(request.status, WithdrawalStatus::Cancelled);
    
    println!("✓ Test: Withdrawal cancelled");
}

#[test]
fn test_cannot_cancel_ready_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, queue) = create_withdrawal_queue(&env);
    let user = Address::generate(&env);
    
    let request_id = queue.enqueue(&user, &1000_0000000);
    queue.mark_ready(&request_id);
    
    // Try to cancel - should fail
    let result = std::panic::catch_unwind(|| {
        queue.cancel_withdrawal(&request_id);
    });
    
    assert!(result.is_err());
    
    println!("✓ Test: Cannot cancel ready withdrawal");
}

#[test]
fn test_unlock_time_calculation() {
    let env = Env::default();
    env.mock_all_auths();
    
    env.ledger().set(LedgerInfo {
        timestamp: 1000000,
        protocol_version: 20,
        sequence_number: 10,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3110400,
    });
    
    let (_, _, queue) = create_withdrawal_queue(&env);
    let user = Address::generate(&env);
    
    let request_id = queue.enqueue(&user, &1000_0000000);
    let request = queue.get_request(&request_id).unwrap();
    
    // Unlock time should be created_at + 7 days
    assert_eq!(request.unlock_time, request.created_at + 604800);
    
    println!("✓ Test: Unlock time calculated correctly");
    println!("  Created at: {}", request.created_at);
    println!("  Unlock at: {}", request.unlock_time);
}

#[test]
fn test_sequential_request_ids() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (_, _, queue) = create_withdrawal_queue(&env);
    let user = Address::generate(&env);
    
    let id1 = queue.enqueue(&user, &100_0000000);
    let id2 = queue.enqueue(&user, &200_0000000);
    let id3 = queue.enqueue(&user, &300_0000000);
    
    assert_eq!(id1, 0);
    assert_eq!(id2, 1);
    assert_eq!(id3, 2);
    
    println!("✓ Test: Request IDs are sequential");
}

// Run with: cargo test --package withdrawal-queue