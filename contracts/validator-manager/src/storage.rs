use soroban_sdk::{Address, Env, Map, Symbol, Vec};
use crate::types::Validator;

const ADMIN: Symbol = Symbol::short("ADMIN");
const STAKING_POOL: Symbol = Symbol::short("POOL");
const VALIDATORS: Symbol = Symbol::short("VALS");
const ALLOCATIONS: Symbol = Symbol::short("ALLOCS");
const TOTAL_ALLOCATED: Symbol = Symbol::short("TOTALLOC");
const INITIALIZED: Symbol = Symbol::short("INIT");

// ADMIN 

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&ADMIN).unwrap()
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&ADMIN, admin);
}

// STAKING POOL 

pub fn get_staking_pool(env: &Env) -> Address {
    env.storage().instance().get(&STAKING_POOL).unwrap()
}

pub fn set_staking_pool(env: &Env, pool: &Address) {
    env.storage().instance().set(&STAKING_POOL, pool);
}

// VALIDATORS 

pub fn get_validators(env: &Env) -> Vec<Validator> {
    env.storage().instance().get(&VALIDATORS)
        .unwrap_or(Vec::new(env))
}

pub fn set_validators(env: &Env, validators: &Vec<Validator>) {
    env.storage().instance().set(&VALIDATORS, validators);
}

// VALIDATOR ALLOCATIONS 

pub fn get_validator_allocations(env: &Env) -> Map<Address, i128> {
    env.storage().instance().get(&ALLOCATIONS)
        .unwrap_or(Map::new(env))
}

pub fn set_validator_allocations(env: &Env, allocations: &Map<Address, i128>) {
    env.storage().instance().set(&ALLOCATIONS, allocations);
}

// TOTAL ALLOCATED 

pub fn get_total_allocated(env: &Env) -> i128 {
    env.storage().instance().get(&TOTAL_ALLOCATED).unwrap_or(0)
}

pub fn set_total_allocated(env: &Env, amount: i128) {
    env.storage().instance().set(&TOTAL_ALLOCATED, &amount);
}



pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().get(&INITIALIZED).unwrap_or(false)
}

pub fn set_initialized(env: &Env, initialized: bool) {
    env.storage().instance().set(&INITIALIZED, &initialized);
}