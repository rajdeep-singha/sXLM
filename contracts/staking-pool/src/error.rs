use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {

    AlreadyInitialized = 1,
    
    InvalidAmount = 2,
    
    InsufficientBalance = 3,
    
    ContractPaused = 4,
    
    Unauthorized = 5,
    
    InvalidExchangeRate = 6,
    
    CrossContractCallFailed = 7,
    
    InvalidAddress = 8,
}