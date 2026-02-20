#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, Symbol, Vec, token,
    log
};

mod storage;
mod events;
mod error;

use storage::{
    get_total_xlm_staked, set_total_xlm_staked,
    get_admin, set_admin,
    get_sxlm_token, set_sxlm_token,
    get_validator_manager, set_validator_manager,
    get_withdrawal_queue, set_withdrawal_queue,
    get_liquidity_buffer, set_liquidity_buffer,
    get_paused, set_paused,
    is_initialized, set_initialized,
};

use events::{stake_event, unstake_event, rewards_accrued_event};
use error::Error;

const PRECISION: i128 = 10_000_000; // 7 decimal precision for exchange rate

#[contract]
pub struct StakingPool;

#[contractimpl]
impl StakingPool {
        
    pub fn initialize(
        env: Env,
        admin: Address,
        sxlm_token: Address,
        validator_manager: Address,
        withdrawal_queue: Address,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        set_admin(&env, &admin);
        set_sxlm_token(&env, &sxlm_token);
        set_validator_manager(&env, &validator_manager);
        set_withdrawal_queue(&env, &withdrawal_queue);
        set_total_xlm_staked(&env, 0);
        set_liquidity_buffer(&env, 0);
        set_paused(&env, false);
        set_initialized(&env, true);

        log!(&env, "StakingPool: Initialized");
        Ok(())
    }

    pub fn deposit(env: Env, user: Address, amount: i128) -> Result<i128, Error> {
        user.require_auth();
        
        if get_paused(&env) {
            return Err(Error::ContractPaused);
        }

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // Get current state
        let total_xlm_staked = get_total_xlm_staked(&env);
        let sxlm_token = get_sxlm_token(&env);
        let sxlm_supply = Self::get_sxlm_total_supply(&env, &sxlm_token);

        // Calculate sXLM to mint
        let sxlm_to_mint = Self::calculate_sxlm_mint_amount(
            amount,
            total_xlm_staked,
            sxlm_supply
        );

        // Transfer XLM from user to contract
        let xlm_token = token::Client::new(&env, &Self::get_native_token(&env));
        xlm_token.transfer(&user, &env.current_contract_address(), &amount);

        // Mint sXLM to user
        Self::mint_sxlm(&env, &sxlm_token, &user, sxlm_to_mint)?;

        // Update total staked
        set_total_xlm_staked(&env, total_xlm_staked + amount);

        // Delegate to validators via Validator Manager
        let validator_manager = get_validator_manager(&env);
        Self::delegate_to_validators(&env, &validator_manager, amount)?;

        // Emit event
        stake_event(&env, user.clone(), amount, sxlm_to_mint);

        log!(&env, "Deposit: user={}, xlm={}, sxlm={}", user, amount, sxlm_to_mint);

        Ok(sxlm_to_mint)
    }

    // Request withdrawal of sXLM to receive XLM
    pub fn request_withdrawal(
        env: Env,
        user: Address,
        sxlm_amount: i128
    ) -> Result<(), Error> {
        user.require_auth();

        if get_paused(&env) {
            return Err(Error::ContractPaused);
        }

        if sxlm_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let sxlm_token = get_sxlm_token(&env);
        
        
        let user_balance = Self::get_sxlm_balance(&env, &sxlm_token, &user);
        if user_balance < sxlm_amount {
            return Err(Error::InsufficientBalance);
        }

        
        let total_xlm_staked = get_total_xlm_staked(&env);
        let sxlm_supply = Self::get_sxlm_total_supply(&env, &sxlm_token);
        
        let xlm_amount = Self::calculate_xlm_redemption_amount(
            sxlm_amount,
            total_xlm_staked,
            sxlm_supply
        );

        Self::burn_sxlm(&env, &sxlm_token, &user, sxlm_amount)?;

        set_total_xlm_staked(&env, total_xlm_staked - xlm_amount);

        
        let liquidity_buffer = get_liquidity_buffer(&env);
        
        if liquidity_buffer >= xlm_amount {
            
            Self::instant_redemption(&env, &user, xlm_amount)?;
            set_liquidity_buffer(&env, liquidity_buffer - xlm_amount);
            
            log!(&env, "Instant withdrawal: user={}, xlm={}", user, xlm_amount);
        } else {
            
            let withdrawal_queue = get_withdrawal_queue(&env);
            Self::enqueue_withdrawal(&env, &withdrawal_queue, &user, xlm_amount)?;
            
            log!(&env, "Queued withdrawal: user={}, xlm={}", user, xlm_amount);
        }

        unstake_event(&env, user, sxlm_amount, xlm_amount);

        Ok(())
    }

    // Update rewards (called by our backend)
    pub fn accrue_rewards(env: Env, reward_amount: i128) -> Result<(), Error> {
        let admin = get_admin(&env);
        admin.require_auth();

        if reward_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let total_xlm_staked = get_total_xlm_staked(&env);
        set_total_xlm_staked(&env, total_xlm_staked + reward_amount);

        rewards_accrued_event(&env, reward_amount);

        log!(&env, "Rewards accrued: {}", reward_amount);
        Ok(())
    }

    // Get current exchange rate (XLM per sXLM)
   
    pub fn get_exchange_rate(env: Env) -> i128 {
        let total_xlm_staked = get_total_xlm_staked(&env);
        let sxlm_token = get_sxlm_token(&env);
        let sxlm_supply = Self::get_sxlm_total_supply(&env, &sxlm_token);

        if sxlm_supply == 0 {
            return PRECISION; // 1:1 initial rate
        }

        // exchange_rate = total_xlm_staked / sxlm_supply
        (total_xlm_staked * PRECISION) / sxlm_supply
    }

    pub fn get_total_staked(env: Env) -> i128 {
        get_total_xlm_staked(&env)
    }

    pub fn get_total_supply(env: Env) -> i128 {
        let sxlm_token = get_sxlm_token(&env);
        Self::get_sxlm_total_supply(&env, &sxlm_token)
    }

    
    pub fn pause(env: Env) -> Result<(), Error> {
        let admin = get_admin(&env);
        admin.require_auth();
        
        set_paused(&env, true);
        log!(&env, "Contract paused");
        Ok(())
    }

    
    pub fn unpause(env: Env) -> Result<(), Error> {
        let admin = get_admin(&env);
        admin.require_auth();
        
        set_paused(&env, false);
        log!(&env, "Contract unpaused");
        Ok(())
    }



    // how much sXLM to mint for a given XLM deposit
    fn calculate_sxlm_mint_amount(
        xlm_amount: i128,
        total_xlm_staked: i128,
        sxlm_supply: i128
    ) -> i128 {
        if sxlm_supply == 0 || total_xlm_staked == 0 {
            // Initial deposit: 1:1 ratio
            return xlm_amount;
        }

        (xlm_amount * sxlm_supply) / total_xlm_staked
    }


    fn calculate_xlm_redemption_amount(
        sxlm_amount: i128,
        total_xlm_staked: i128,
        sxlm_supply: i128
    ) -> i128 {
        if sxlm_supply == 0 {
            return 0;
        }

        (sxlm_amount * total_xlm_staked) / sxlm_supply
    }

    fn instant_redemption(env: &Env, user: &Address, xlm_amount: i128) -> Result<(), Error> {
        let xlm_token = token::Client::new(env, &Self::get_native_token(env));
        xlm_token.transfer(&env.current_contract_address(), user, &xlm_amount);
        Ok(())
    }

    
    fn delegate_to_validators(
        env: &Env,
        validator_manager: &Address,
        amount: i128
    ) -> Result<(), Error> {
        // Cross-contract call to Validator Manager
        let client = validator_manager::Client::new(env, validator_manager);
        client.allocate_stake(&amount);
        Ok(())
    }

    fn enqueue_withdrawal(
        env: &Env,
        withdrawal_queue: &Address,
        user: &Address,
        xlm_amount: i128
    ) -> Result<(), Error> {
        let client = withdrawal_queue::Client::new(env, withdrawal_queue);
        client.enqueue(user, &xlm_amount);
        Ok(())
    }

    // Mint sXLM tokens
    fn mint_sxlm(
        env: &Env,
        sxlm_token: &Address,
        to: &Address,
        amount: i128
    ) -> Result<(), Error> {
        let client = sxlm_token::Client::new(env, sxlm_token);
        client.mint(to, &amount);
        Ok(())
    }

    // Burn sXLM tokens
    fn burn_sxlm(
        env: &Env,
        sxlm_token: &Address,
        from: &Address,
        amount: i128
    ) -> Result<(), Error> {
        let client = sxlm_token::Client::new(env, sxlm_token);
        client.burn(from, &amount);
        Ok(())
    }

    // Get sXLM total supply
    fn get_sxlm_total_supply(env: &Env, sxlm_token: &Address) -> i128 {
        let client = token::Client::new(env, sxlm_token);
        client.total_supply()
    }

    // Get user's sXLM balance
    fn get_sxlm_balance(env: &Env, sxlm_token: &Address, user: &Address) -> i128 {
        let client = token::Client::new(env, sxlm_token);
        client.balance(user)
    }

    // Get native XLM token address
    fn get_native_token(env: &Env) -> Address {
        // Stellar native asset address (XLM)
        Address::from_string(&String::from_str(env, "NATIVE_XLM_ADDRESS"))
    }
}

// Import external contract interfaces
mod validator_manager {
    soroban_sdk::contractimport!(
        file = "../validator-manager/target/wasm32-unknown-unknown/release/validator_manager.wasm"
    );
}

mod withdrawal_queue {
    soroban_sdk::contractimport!(
        file = "../withdrawal-queue/target/wasm32-unknown-unknown/release/withdrawal_queue.wasm"
    );
}

mod sxlm_token {
    soroban_sdk::contractimport!(
        file = "../sxlm-token/target/wasm32-unknown-unknown/release/sxlm_token.wasm"
    );
}

#[cfg(test)]
mod test{
    include!("test.rs");
}