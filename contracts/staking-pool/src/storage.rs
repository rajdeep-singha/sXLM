use soroban_sdk::{Address, Env, Symbol};

const TOTAL_XLM_STAKED: Symbol = Symbol::short("TOTXLM");
const ADMIN: Symbol = Symbol::short("ADMIN");
const SXLM_TOKEN: Symbol = Symbol::short("SXLM");
const VALIDATOR_MGR: Symbol = Symbol::short("VALMGR");
const WITHDRAWAL_Q: Symbol = Symbol::short("WDRAWQ");
const LIQUIDITY_BUF: Symbol = Symbol::short("LIQBUF");
const PAUSED: Symbol = Symbol::short("PAUSED");
const INITIALIZED: Symbol = Symbol::short("INIT");



pub fn get_total_xlm_staked(env: &Env) -> i128 {
    env.storage().instance().get(&TOTAL_XLM_STAKED).unwrap_or(0)
}

pub fn set_total_xlm_staked(env: &Env, amount: i128) {
    env.storage().instance().set(&TOTAL_XLM_STAKED, &amount);
}

// ADMIN 

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&ADMIN).unwrap()
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&ADMIN, admin);
}

// ============ SXLM TOKEN 

pub fn get_sxlm_token(env: &Env) -> Address {
    env.storage().instance().get(&SXLM_TOKEN).unwrap()
}

pub fn set_sxlm_token(env: &Env, token: &Address) {
    env.storage().instance().set(&SXLM_TOKEN, token);
}

//  VALIDATOR MANAGER 

pub fn get_validator_manager(env: &Env) -> Address {
    env.storage().instance().get(&VALIDATOR_MGR).unwrap()
}

pub fn set_validator_manager(env: &Env, manager: &Address) {
    env.storage().instance().set(&VALIDATOR_MGR, manager);
}

//  WITHDRAWAL QUEUE 

pub fn get_withdrawal_queue(env: &Env) -> Address {
    env.storage().instance().get(&WITHDRAWAL_Q).unwrap()
}

pub fn set_withdrawal_queue(env: &Env, queue: &Address) {
    env.storage().instance().set(&WITHDRAWAL_Q, queue);
}

//  LIQUIDITY BUFFER 

pub fn get_liquidity_buffer(env: &Env) -> i128 {
    env.storage().instance().get(&LIQUIDITY_BUF).unwrap_or(0)
}

pub fn set_liquidity_buffer(env: &Env, amount: i128) {
    env.storage().instance().set(&LIQUIDITY_BUF, &amount);
}

//  PAUSED STATE 

pub fn get_paused(env: &Env) -> bool {
    env.storage().instance().get(&PAUSED).unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&PAUSED, &paused);
}

//  INITIALIZED STATE 

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().get(&INITIALIZED).unwrap_or(false)
}

pub fn set_initialized(env: &Env, initialized: bool) {
    env.storage().instance().set(&INITIALIZED, &initialized);
}