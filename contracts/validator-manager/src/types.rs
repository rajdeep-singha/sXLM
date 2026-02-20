use soroban_sdk::{contracttype, Address};

/// Represents a validator in the curated set
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Validator {
    
    pub address: Address,
    pub score: u32,
    pub commission: u32,
    pub uptime: u32,
    pub is_active: bool,
}


#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatorAllocation {
    
    pub validator_address: Address,
    
    // Amount of XLM allocated
    pub amount: i128,
}