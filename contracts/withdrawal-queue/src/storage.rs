use soroban_sdk::{Address, Env, Map, Symbol};
use crate::types::WithdrawalRequest;

const ADMIN: Symbol = Symbol::short("ADMIN");
const STAKING_POOL: Symbol = Symbol::short("POOL");
const QUEUE: Symbol = Symbol::short("QUEUE");
const NEXT_ID: Symbol = Symbol::short("NEXTID");
const INITIALIZED: Symbol = Symbol::short("INIT");

// ============ ADMIN ============

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&ADMIN).unwrap()
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&ADMIN, admin);
}

// ============ STAKING POOL ============

pub fn get_staking_pool(env: &Env) -> Address {
    env.storage().instance().get(&STAKING_POOL).unwrap()
}

pub fn set_staking_pool(env: &Env, pool: &Address) {
    env.storage().instance().set(&STAKING_POOL, pool);
}

// ============ WITHDRAWAL QUEUE ============

pub fn get_queue(env: &Env) -> Map<u64, WithdrawalRequest> {
    env.storage().instance().get(&QUEUE)
        .unwrap_or(Map::new(env))
}

pub fn set_queue(env: &Env, queue: &Map<u64, WithdrawalRequest>) {
    env.storage().instance().set(&QUEUE, queue);
}

// ============ NEXT REQUEST ID ============

pub fn get_next_id(env: &Env) -> u64 {
    env.storage().instance().get(&NEXT_ID).unwrap_or(0)
}

pub fn set_next_id(env: &Env, id: u64) {
    env.storage().instance().set(&NEXT_ID, &id);
}

// ============ INITIALIZED ============

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().get(&INITIALIZED).unwrap_or(false)
}

pub fn set_initialized(env: &Env, initialized: bool) {
    env.storage().instance().set(&INITIALIZED, &initialized);
}