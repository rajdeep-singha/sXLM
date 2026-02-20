#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, String, symbol_short
};

mod storage;
mod error;

use storage::{
    get_admin, set_admin,
    get_minter, set_minter,
    is_initialized, set_initialized,
};
use error::Error;

#[contract]
pub struct SXLMToken;

#[contractimpl]
impl SXLMToken {
    
    // Sets up token metadata and minter address
    pub fn initialize(
        env: Env,
        admin: Address,
        minter: Address, // Staking Pool contract address
        decimal: u32,
        name: String,
        symbol: String,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        // Initialize standard token
        token::Client::new(&env, &env.current_contract_address()).initialize(
            &admin,
            &decimal,
            &name,
            &symbol,
        );

        set_admin(&env, &admin);
        set_minter(&env, &minter);
        set_initialized(&env, true);

        env.events().publish((symbol_short!("init"),), minter);

        Ok(())
    }

    // Mint new sXLM tokens and Can only be called by the authorized minter (Staking Pool)
    pub fn mint(env: Env, to: Address, amount: i128) -> Result<(), Error> {
        let minter = get_minter(&env);
        minter.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let token = token::Client::new(&env, &env.current_contract_address());
        token.mint(&to, &amount);

        env.events().publish(
            (symbol_short!("mint"), to.clone()),
            amount
        );

        Ok(())
    }

    // Burn sXLM tokens and Can only be called by the authorized minter (Staking Pool)
    pub fn burn(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        let minter = get_minter(&env);
        minter.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let token = token::Client::new(&env, &env.current_contract_address());
        token.burn(&from, &amount);

        env.events().publish(
            (symbol_short!("burn"), from.clone()),
            amount
        );

        Ok(())
    }

    // Update the minter address and Can only be called by admin (for contract upgrades)
    pub fn set_new_minter(env: Env, new_minter: Address) -> Result<(), Error> {
        let admin = get_admin(&env);
        admin.require_auth();

        set_minter(&env, &new_minter);

        env.events().publish(
            (symbol_short!("minter"),),
            new_minter
        );

        Ok(())
    }

    // Get current minter address
    pub fn get_minter_address(env: Env) -> Address {
        get_minter(&env)
    }

    // Get admin address
    pub fn get_admin_address(env: Env) -> Address {
        get_admin(&env)
    }

    //  STANDARD TOKEN FUNCTIONS (delegated) 
    

    pub fn balance(env: Env, id: Address) -> i128 {
        let token = token::Client::new(&env, &env.current_contract_address());
        token.balance(&id)
    }

    
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let token = token::Client::new(&env, &env.current_contract_address());
        token.transfer(&from, &to, &amount);
    }

    
    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        amount: i128,
    ) {
        let token = token::Client::new(&env, &env.current_contract_address());
        token.transfer_from(&spender, &from, &to, &amount);
    }

    // Approve spending allowance
    pub fn approve(
        env: Env,
        from: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) {
        let token = token::Client::new(&env, &env.current_contract_address());
        token.approve(&from, &spender, &amount, &expiration_ledger);
    }

    // Get allowance
    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        let token = token::Client::new(&env, &env.current_contract_address());
        token.allowance(&from, &spender)
    }

    // Get total supply
    pub fn total_supply(env: Env) -> i128 {
        let token = token::Client::new(&env, &env.current_contract_address());
        token.total_supply()
    }

    // Get token name
    pub fn name(env: Env) -> String {
        let token = token::Client::new(&env, &env.current_contract_address());
        token.name()
    }

    // Get token symbol
    pub fn symbol(env: Env) -> String {
        let token = token::Client::new(&env, &env.current_contract_address());
        token.symbol()
    }

    // Get token decimals
    pub fn decimals(env: Env) -> u32 {
        let token = token::Client::new(&env, &env.current_contract_address());
        token.decimals()
    }
}

#[cfg(test)]
mod test {
    include!("test.rs");
}