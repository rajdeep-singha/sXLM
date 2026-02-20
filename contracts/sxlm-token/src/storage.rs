use soroban_sdk::{Address, Env, Symbol};

const ADMIN: Symbol = Symbol::short("ADMIN");
const MINTER: Symbol = Symbol::short("MINTER");
const INITIALIZED: Symbol = Symbol::short("INIT");

// ADMIN 

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&ADMIN).unwrap()
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&ADMIN, admin);
}

// MINTER 

pub fn get_minter(env: &Env) -> Address {
    env.storage().instance().get(&MINTER).unwrap()
}

pub fn set_minter(env: &Env, minter: &Address) {
    env.storage().instance().set(&MINTER, minter);
}



pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().get(&INITIALIZED).unwrap_or(false)
}

pub fn set_initialized(env: &Env, initialized: bool) {
    env.storage().instance().set(&INITIALIZED, &initialized);
}