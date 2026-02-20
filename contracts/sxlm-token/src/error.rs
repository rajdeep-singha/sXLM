use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    
    AlreadyInitialized = 1,
    
    
    InvalidAmount = 2,
    
    
    Unauthorized = 3,
    
    
    InvalidAddress = 4,
}