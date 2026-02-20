#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, Map, Vec, log, symbol_short
};

mod storage;
mod types;

use storage::{
    get_admin, set_admin,
    get_staking_pool, set_staking_pool,
    get_queue, set_queue,
    get_next_id, set_next_id,
    is_initialized, set_initialized,
};

use types::{WithdrawalRequest, WithdrawalStatus};

const UNBONDING_PERIOD: u64 = 604800; // 7 days in seconds

#[contract]
pub struct WithdrawalQueue;

#[contractimpl]
impl WithdrawalQueue {
    
    /// Initialize the Withdrawal Queue
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
        set_next_id(&env, 0);
        set_initialized(&env, true);

        log!(&env, "WithdrawalQueue: Initialized");
        Ok(())
    }

    
    pub fn enqueue(
        env: Env,
        user: Address,
        xlm_amount: i128,
    ) -> Result<u64, u32> {
        let staking_pool = get_staking_pool(&env);
        staking_pool.require_auth();

        if xlm_amount <= 0 {
            return Err(2); // InvalidAmount
        }

        let request_id = get_next_id(&env);
        let current_time = env.ledger().timestamp();
        let unlock_time = current_time + UNBONDING_PERIOD;

        let request = WithdrawalRequest {
            id: request_id,
            user: user.clone(),
            xlm_amount,
            status: WithdrawalStatus::Pending,
            created_at: current_time,
            unlock_time,
        };

        let mut queue = get_queue(&env);
        queue.set(request_id, request.clone());
        set_queue(&env, &queue);
        set_next_id(&env, request_id + 1);

        env.events().publish(
            (symbol_short!("enqueue"),),
            (request_id, user, xlm_amount, unlock_time)
        );

        log!(
            &env,
            "Withdrawal enqueued: id={}, user={}, amount={}, unlock={}",
            request_id, user, xlm_amount, unlock_time
        );

        Ok(request_id)
    }

    /// Mark a withdrawal as ready for claiming
    pub fn mark_ready(
        env: Env,
        request_id: u64,
    ) -> Result<(), u32> {
        let admin = get_admin(&env);
        admin.require_auth();

        let mut queue = get_queue(&env);
        
        let mut request = queue.get(request_id)
            .ok_or(3)?; // RequestNotFound

        if request.status != WithdrawalStatus::Pending {
            return Err(4); // InvalidStatus
        }

        request.status = WithdrawalStatus::Ready;
        queue.set(request_id, request.clone());
        set_queue(&env, &queue);

        env.events().publish(
            (symbol_short!("ready"),),
            (request_id, request.user.clone())
        );

        log!(&env, "Withdrawal ready: id={}", request_id);
        Ok(())
    }

    /// User claims their withdrawal
    pub fn claim(
        env: Env,
        request_id: u64,
    ) -> Result<(), u32> {
        let mut queue = get_queue(&env);
        
        let mut request = queue.get(request_id)
            .ok_or(3)?; // RequestNotFound

        request.user.require_auth();

        if request.status != WithdrawalStatus::Ready {
            return Err(5); // NotReadyToClaim
        }

        let current_time = env.ledger().timestamp();
        if current_time < request.unlock_time {
            return Err(6); // StillLocked
        }

        Self::transfer_xlm(&env, &request.user, request.xlm_amount)?;

        // Mark as claimed
        request.status = WithdrawalStatus::Claimed;
        queue.set(request_id, request.clone());
        set_queue(&env, &queue);

        env.events().publish(
            (symbol_short!("claimed"),),
            (request_id, request.user.clone(), request.xlm_amount)
        );

        log!(
            &env,
            "Withdrawal claimed: id={}, user={}, amount={}",
            request_id, request.user, request.xlm_amount
        );

        Ok(())
    }

    // Batch process multiple withdrawals to ready state
    // Gas optimization for backend
    pub fn batch_mark_ready(
        env: Env,
        request_ids: Vec<u64>,
    ) -> Result<(), u32> {
        let admin = get_admin(&env);
        admin.require_auth();

        let mut queue = get_queue(&env);

        for id in request_ids.iter() {
            if let Some(mut request) = queue.get(id) {
                if request.status == WithdrawalStatus::Pending {
                    request.status = WithdrawalStatus::Ready;
                    queue.set(id, request);
                }
            }
        }

        set_queue(&env, &queue);

        log!(&env, "Batch marked ready: {} requests", request_ids.len());
        Ok(())
    }

    pub fn get_request(env: Env, request_id: u64) -> Option<WithdrawalRequest> {
        let queue = get_queue(&env);
        queue.get(request_id)
    }

    pub fn get_user_requests(env: Env, user: Address) -> Vec<WithdrawalRequest> {
        let queue = get_queue(&env);
        let mut user_requests = Vec::new(&env);

        for (_, request) in queue.iter() {
            if request.user == user {
                user_requests.push_back(request);
            }
        }

        user_requests
    }

    //(admin only)
    pub fn get_pending_requests(env: Env) -> Vec<WithdrawalRequest> {
        let queue = get_queue(&env);
        let mut pending = Vec::new(&env);

        for (_, request) in queue.iter() {
            if request.status == WithdrawalStatus::Pending {
                pending.push_back(request);
            }
        }

        pending
    }

    // Get queue size
    pub fn get_queue_size(env: Env) -> u32 {
        let queue = get_queue(&env);
        queue.len()
    }

    // Cancel a pending withdrawal (user only, before ready)
    pub fn cancel_withdrawal(
        env: Env,
        request_id: u64,
    ) -> Result<(), u32> {
        let mut queue = get_queue(&env);
        
        let mut request = queue.get(request_id)
            .ok_or(3)?; // RequestNotFound

        request.user.require_auth();

        if request.status != WithdrawalStatus::Pending {
            return Err(7); // CannotCancel
        }

        // Mark as cancelled
        request.status = WithdrawalStatus::Cancelled;
        queue.set(request_id, request.clone());
        set_queue(&env, &queue);

        // Return sXLM to user (would require coordination with Staking Pool)
        // This is a simplification - in production, you'd need to:
        // 1. Calculate sXLM to return based on current exchange rate
        // 2. Call Staking Pool to re-mint sXLM to user

        env.events().publish(
            (symbol_short!("cancel"),),
            (request_id, request.user)
        );

        Ok(())
    }



    /// Transfer XLM to user
    fn transfer_xlm(env: &Env, to: &Address, amount: i128) -> Result<(), u32> {
        // In real implementation, this would transfer XLM from contract to user
        // Using Stellar's native asset transfer
        
        log!(env, "Transferring {} XLM to {}", amount, to);



        Ok(())
    }
}

#[cfg(test)]
mod test {
    include!("test.rs");
}