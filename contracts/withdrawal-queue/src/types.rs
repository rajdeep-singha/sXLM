use soroban_sdk::{contracttype, Address};

/// Status of a withdrawal request
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WithdrawalStatus {
    
    Pending,
    Ready,
    Claimed,
    Cancelled,// Canceled by user before ready
}

/// Represents a withdrawal request in the queue
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawalRequest {
    pub id: u64,
    
    pub user: Address,
    
    pub xlm_amount: i128,
    
    pub status: WithdrawalStatus,
    
    pub created_at: u64,
    
    pub unlock_time: u64,
}