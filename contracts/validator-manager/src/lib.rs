#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, Map, Vec, log, symbol_short
};

mod storage;
mod types;

use storage::{
    get_admin, set_admin,
    get_staking_pool, set_staking_pool,
    get_validators, set_validators,
    get_validator_allocations, set_validator_allocations,
    get_total_allocated, set_total_allocated,
    is_initialized, set_initialized,
};

use types::{Validator, ValidatorAllocation};

const MAX_VALIDATORS: u32 = 20;
const MIN_VALIDATOR_SCORE: u32 = 70; // 70% minimum score

#[contract]
pub struct ValidatorManager;

#[contractimpl]
impl ValidatorManager {
    
    
    pub fn initialize(
        env: Env,
        admin: Address,
        staking_pool: Address,
    ) -> Result<(), u32> {
        if is_initialized(&env) {
            return Err(1); // AlreadyInitialized
        }

        admin.require_auth();

        set_admin(&env, &admin);
        set_staking_pool(&env, &staking_pool);
        set_validators(&env, &Vec::new(&env));
        set_total_allocated(&env, 0);
        set_initialized(&env, true);

        log!(&env, "ValidatorManager: Initialized");
        Ok(())
    }

    //  a validator to the curated set
 
    pub fn add_validator(
        env: Env,
        validator: Validator,
    ) -> Result<(), u32> {
        let admin = get_admin(&env);
        admin.require_auth();

        let mut validators = get_validators(&env);
        
        if validators.len() >= MAX_VALIDATORS {
            return Err(2); 
        }

        // Validate score threshold
        if validator.score < MIN_VALIDATOR_SCORE {
            return Err(3); 
        }

        validators.push_back(validator.clone());
        set_validators(&env, &validators);

        env.events().publish(
            (symbol_short!("add_val"),),
            validator.address
        );

        log!(&env, "Validator added: {}", validator.address);
        Ok(())
    }

    // Remove a validator from the set
    pub fn remove_validator(
        env: Env,
        validator_address: Address,
    ) -> Result<(), u32> {
        let admin = get_admin(&env);
        admin.require_auth();

        let validators = get_validators(&env);
        let mut new_validators = Vec::new(&env);

        let mut found = false;
        for v in validators.iter() {
            if v.address != validator_address {
                new_validators.push_back(v);
            } else {
                found = true;
            }
        }

        if !found {
            return Err(4); // ValidatorNotFound
        }

        set_validators(&env, &new_validators);

        // Trigger rebalancing to redistribute stake
        Self::internal_rebalance(&env)?;

        env.events().publish(
            (symbol_short!("rem_val"),),
            validator_address
        );

        Ok(())
    }

    // Update validator score (called by Risk Engine or Admin)
    pub fn update_validator_score(
        env: Env,
        validator_address: Address,
        new_score: u32,
    ) -> Result<(), u32> {
        let admin = get_admin(&env);
        admin.require_auth();

        let validators = get_validators(&env);
        let mut updated_validators = Vec::new(&env);
        let mut found = false;

        for mut v in validators.iter() {
            if v.address == validator_address {
                v.score = new_score;
                found = true;
                
                // If score drops too low, trigger rebalancing
                if new_score < MIN_VALIDATOR_SCORE {
                    log!(&env, "Validator score too low, rebalancing needed");
                }
            }
            updated_validators.push_back(v);
        }

        if !found {
            return Err(4); // ValidatorNotFound
        }

        set_validators(&env, &updated_validators);

        env.events().publish(
            (symbol_short!("upd_scr"),),
            (validator_address, new_score)
        );

        Ok(())
    }

    // Allocate stake to validators
    // Called by Staking Pool when new deposits arrive
    pub fn allocate_stake(env: Env, amount: i128) -> Result<(), u32> {
        let staking_pool = get_staking_pool(&env);
        staking_pool.require_auth();

        if amount <= 0 {
            return Err(5); // InvalidAmount
        }

        let validators = get_validators(&env);
        if validators.is_empty() {
            return Err(6); // NoValidatorsAvailable
        }

        // Calculate weighted distribution
        let allocations = Self::calculate_allocations(&env, &validators, amount);

        // Execute delegations to Stellar network validators
        for alloc in allocations.iter() {
            Self::delegate_to_stellar_validator(&env, &alloc)?;
        }

        // Update total allocated
        let total_allocated = get_total_allocated(&env);
        set_total_allocated(&env, total_allocated + amount);

        // Store allocations
        let mut current_allocations = get_validator_allocations(&env);
        for alloc in allocations.iter() {
            let current = current_allocations.get(alloc.validator_address.clone())
                .unwrap_or(0);
            current_allocations.set(
                alloc.validator_address.clone(),
                current + alloc.amount
            );
        }
        set_validator_allocations(&env, &current_allocations);

        log!(&env, "Stake allocated: {} XLM", amount);
        Ok(())
    }

    // Trigger rebalancing across validators
    // Redistributes stake to maintain optimal distribution
    pub fn rebalance(env: Env) -> Result<(), u32> {
        let admin = get_admin(&env);
        admin.require_auth();

        Self::internal_rebalance(&env)?;

        log!(&env, "Rebalancing completed");
        Ok(())
    }

    // Get list of current validators
    pub fn get_validators_list(env: Env) -> Vec<Validator> {
        get_validators(&env)
    }

    // Get total amount allocated across all validators
    pub fn get_total_allocated_amount(env: Env) -> i128 {
        get_total_allocated(&env)
    }

    // Get allocation for a specific validator
    pub fn get_validator_allocation(env: Env, validator: Address) -> i128 {
        let allocations = get_validator_allocations(&env);
        allocations.get(validator).unwrap_or(0)
    }

  

    // Calculate stake allocations based on validator scores
    fn calculate_allocations(
        env: &Env,
        validators: &Vec<Validator>,
        total_amount: i128,
    ) -> Vec<ValidatorAllocation> {
        let mut allocations = Vec::new(env);
        
        // Calculate total score weight
        let mut total_score: u32 = 0;
        for v in validators.iter() {
            if v.score >= MIN_VALIDATOR_SCORE {
                total_score += v.score;
            }
        }

        if total_score == 0 {
            return allocations;
        }

        // Allocate proportionally to scores
        for v in validators.iter() {
            if v.score >= MIN_VALIDATOR_SCORE {
                let allocation_amount = (total_amount * v.score as i128) / total_score as i128;
                
                allocations.push_back(ValidatorAllocation {
                    validator_address: v.address.clone(),
                    amount: allocation_amount,
                });
            }
        }

        allocations
    }

    // Internal rebalancing logic
    fn internal_rebalance(env: &Env) -> Result<(), u32> {
        let validators = get_validators(&env);
        let total_allocated = get_total_allocated(&env);
        
        // Recalculate ideal allocations
        let ideal_allocations = Self::calculate_allocations(env, &validators, total_allocated);
        
        let current_allocations = get_validator_allocations(&env);

        // Determine which validators need unstaking/restaking
        for ideal in ideal_allocations.iter() {
            let current = current_allocations.get(ideal.validator_address.clone())
                .unwrap_or(0);
            
            let diff = ideal.amount - current;
            
            if diff > 0 {
                // Need to stake more to this validator
                Self::delegate_to_stellar_validator(env, &ideal)?;
            } else if diff < 0 {
                // Need to unstake from this validator
                Self::undelegate_from_stellar_validator(env, &ideal.validator_address, diff.abs())?;
            }
        }

        // Update stored allocations
        let mut new_allocations = Map::new(env);
        for alloc in ideal_allocations.iter() {
            new_allocations.set(alloc.validator_address.clone(), alloc.amount);
        }
        set_validator_allocations(env, &new_allocations);

        env.events().publish(
            (symbol_short!("rebal"),),
            total_allocated
        );

        Ok(())
    }

    /// Delegate stake to a Stellar validator
    fn delegate_to_stellar_validator(
        env: &Env,
        allocation: &ValidatorAllocation,
    ) -> Result<(), u32> {
        // In real implementation, this would call Stellar RPC to delegate
        // For now, we'll just log the delegation
        
        log!(
            env,
            "Delegating {} XLM to validator {}",
            allocation.amount,
            allocation.validator_address
        );

        // Pseudo-code for actual delegation:
        // stellar_rpc::delegate_stake(
        //     allocation.validator_address,
        //     allocation.amount
        // );

        env.events().publish(
            (symbol_short!("delegate"),),
            (allocation.validator_address.clone(), allocation.amount)
        );

        Ok(())
    }

    // Undelegate stake from a Stellar validator
    fn undelegate_from_stellar_validator(
        env: &Env,
        validator: &Address,
        amount: i128,
    ) -> Result<(), u32> {
        log!(
            env,
            "Undelegating {} XLM from validator {}",
            amount,
            validator
        );

        // Pseudo-code for actual undelegation:
        // stellar_rpc::undelegate_stake(validator, amount);

        env.events().publish(
            (symbol_short!("undeleg"),),
            (validator.clone(), amount)
        );

        Ok(())
    }
}

#[cfg(test)]
mod test {
    include!("test.rs");
}