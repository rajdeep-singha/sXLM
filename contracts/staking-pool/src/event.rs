use soroban_sdk::{Address, Env, Symbol, symbol_short};

// Event emitted when a user stakes XLM
pub fn stake_event(env: &Env, user: Address, xlm_amount: i128, sxlm_amount: i128) {
    let topics = (symbol_short!("stake"), user);
    env.events().publish(topics, (xlm_amount, sxlm_amount));
}

// Event emitted when a user requests withdrawal
pub fn unstake_event(env: &Env, user: Address, sxlm_amount: i128, xlm_amount: i128) {
    let topics = (symbol_short!("unstake"), user);
    env.events().publish(topics, (sxlm_amount, xlm_amount));
}

// Event emitted when staking rewards are accrued to the pool
pub fn rewards_accrued_event(env: &Env, reward_amount: i128) {
    let topics = (symbol_short!("rewards"),);
    env.events().publish(topics, reward_amount);
}

// Event emitted when exchange rate is updated
pub fn exchange_rate_updated_event(env: &Env, new_rate: i128) {
    let topics = (symbol_short!("rate"),);
    env.events().publish(topics, new_rate);
}