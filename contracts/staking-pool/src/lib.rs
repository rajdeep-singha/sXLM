#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, Symbol, Vec, token,
    log
};
mod storage;
mod events;
mod error;

use storage::{
    get_total_xlm_staked,
    set_total_xlm_staked,
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

const PRECISION: i128 = 10_000_000;
#[contract]
pub struct StakingPool;