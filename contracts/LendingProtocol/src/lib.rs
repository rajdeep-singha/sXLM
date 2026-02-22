#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, Address, Env, Map, Symbol, Vec, 
    token, log, symbol_short,
};

const SECONDS_PER_YEAR: u64 = 31536000;
const PRECISION: i128 = 10_000_000; // 7 decimals
const COLLATERAL_FACTOR: i128 = 70; // 70% LTV
const BORROW_RATE: i128 = 5_00; // 5% APR (in basis points with 2 decimals)
const LIQUIDATION_THRESHOLD: i128 = 80; // 80% - liquidation happens
const LIQUIDATION_BONUS: i128 = 5; // 5% bonus for liquidators


#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    InsufficientCollateral = 5,
    HealthFactorTooLow = 6,
    PositionHealthy = 7,
    NoDebt = 8,
    NothingToRepay = 9,
}


const ADMIN: Symbol = Symbol::short("ADMIN");
const SXLM_TOKEN: Symbol = Symbol::short("SXLM");
const XLM_TOKEN: Symbol = Symbol::short("XLM");
const STAKING_POOL: Symbol = Symbol::short("POOL");
const POSITIONS: Symbol = Symbol::short("POS");
const TOTAL_COLLATERAL: Symbol = Symbol::short("TOTCOL");
const TOTAL_BORROWED: Symbol = Symbol::short("TOTBOR");
const INITIALIZED: Symbol = Symbol::short("INIT");


#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Position {
    pub owner: Address,
    pub collateral: i128,          // sXLM deposited
    pub borrowed: i128,            // XLM borrowed
    pub last_update: u64,          // Timestamp of last interest update
}


#[contract]
pub struct LendingProtocol;

#[contractimpl]
impl LendingProtocol {
    
    pub fn initialize(
        env: Env,
        admin: Address,
        sxlm_token: Address,
        xlm_token: Address,
        staking_pool: Address,
    ) -> Result<(), Error> {
        if Self::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        
        admin.require_auth();
        
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&SXLM_TOKEN, &sxlm_token);
        env.storage().instance().set(&XLM_TOKEN, &xlm_token);
        env.storage().instance().set(&STAKING_POOL, &staking_pool);
        env.storage().instance().set(&TOTAL_COLLATERAL, &0i128);
        env.storage().instance().set(&TOTAL_BORROWED, &0i128);
        env.storage().instance().set(&INITIALIZED, &true);
        
        log!(&env, "LendingProtocol: Initialized");
        Ok(())
    }
    
    // Deposit sXLM as collateral
    pub fn deposit_collateral(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        user.require_auth();
        
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        
        let sxlm_token: Address = env.storage().instance().get(&SXLM_TOKEN).unwrap();
        
        let token_client = token::Client::new(&env, &sxlm_token);
        token_client.transfer(&user, &env.current_contract_address(), &amount);
        
        let mut position = Self::get_position(&env, &user);
        position.collateral += amount;
        position.last_update = env.ledger().timestamp();
        Self::set_position(&env, &user, &position);
        
        // Update total collateral
        let total: i128 = env.storage().instance().get(&TOTAL_COLLATERAL).unwrap();
        env.storage().instance().set(&TOTAL_COLLATERAL, &(total + amount));
        
        env.events().publish(
            (symbol_short!("deposit"), user),
            amount
        );
        
        log!(&env, "Deposited {} sXLM as collateral", amount);
        Ok(())
    }
    
    // Borrow XLM against sXLM collateral
    pub fn borrow(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        user.require_auth();
        
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        
        let mut position = Self::get_position(&env, &user);
        Self::apply_interest(&env, &mut position);
        
        let max_borrow = Self::calculate_max_borrow(&env, &position)?;
        
        if amount > max_borrow {
            return Err(Error::InsufficientCollateral);
        }
        
        position.borrowed += amount;
        let health_factor = Self::calculate_health_factor(&env, &position)?;
        
        if health_factor < PRECISION {
            return Err(Error::HealthFactorTooLow);
        }
        
        position.last_update = env.ledger().timestamp();
        Self::set_position(&env, &user, &position);
        
        let xlm_token: Address = env.storage().instance().get(&XLM_TOKEN).unwrap();
        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&env.current_contract_address(), &user, &amount);
        
        let total: i128 = env.storage().instance().get(&TOTAL_BORROWED).unwrap();
        env.storage().instance().set(&TOTAL_BORROWED, &(total + amount));
        
        env.events().publish(
            (symbol_short!("borrow"), user),
            amount
        );
        
        log!(&env, "Borrowed {} XLM", amount);
        Ok(())
    }
    
    // Repay borrowed XLM
    pub fn repay(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        user.require_auth();
        
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        
        let mut position = Self::get_position(&env, &user);
        
        if position.borrowed == 0 {
            return Err(Error::NoDebt);
        }
        
        Self::apply_interest(&env, &mut position);
        
        let repay_amount = if amount > position.borrowed {
            position.borrowed
        } else {
            amount
        };
        
        let xlm_token: Address = env.storage().instance().get(&XLM_TOKEN).unwrap();
        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&user, &env.current_contract_address(), &repay_amount);
        
        position.borrowed -= repay_amount;
        position.last_update = env.ledger().timestamp();
        Self::set_position(&env, &user, &position);
        
        let total: i128 = env.storage().instance().get(&TOTAL_BORROWED).unwrap();
        env.storage().instance().set(&TOTAL_BORROWED, &(total - repay_amount));
        
        env.events().publish(
            (symbol_short!("repay"), user),
            repay_amount
        );
        
        log!(&env, "Repaid {} XLM", repay_amount);
        Ok(())
    }
    
    // Withdraw collateral
    pub fn withdraw_collateral(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        user.require_auth();
        
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        
        let mut position = Self::get_position(&env, &user);
        
        if position.collateral < amount {
            return Err(Error::InsufficientCollateral);
        }
        
        Self::apply_interest(&env, &mut position);
        
        position.collateral -= amount;
        
        if position.borrowed > 0 {
            let health_factor = Self::calculate_health_factor(&env, &position)?;
            if health_factor < PRECISION {
                return Err(Error::HealthFactorTooLow);
            }
        }
        
        position.last_update = env.ledger().timestamp();
        Self::set_position(&env, &user, &position);
        
        let sxlm_token: Address = env.storage().instance().get(&SXLM_TOKEN).unwrap();
        let token_client = token::Client::new(&env, &sxlm_token);
        token_client.transfer(&env.current_contract_address(), &user, &amount);
        
        let total: i128 = env.storage().instance().get(&TOTAL_COLLATERAL).unwrap();
        env.storage().instance().set(&TOTAL_COLLATERAL, &(total - amount));
        
        env.events().publish(
            (symbol_short!("withdraw"), user),
            amount
        );
        
        Ok(())
    }
    
    // Liquidate unhealthy position
    pub fn liquidate(
        env: Env,
        liquidator: Address,
        borrower: Address,
        repay_amount: i128,
    ) -> Result<(), Error> {
        liquidator.require_auth();
        
        let mut position = Self::get_position(&env, &borrower);
        
        if position.borrowed == 0 {
            return Err(Error::NoDebt);
        }
        
        Self::apply_interest(&env, &mut position);
        
        let health_factor = Self::calculate_health_factor(&env, &position)?;
        
        if health_factor >= PRECISION {
            return Err(Error::PositionHealthy);
        }
        
        let collateral_value = Self::get_collateral_value(&env, position.collateral)?;
        let repay_value = repay_amount;
        let seize_amount = (repay_amount * (100 + LIQUIDATION_BONUS) * position.collateral) 
            / (collateral_value * 100);
        
        // Cap at available collateral
        let actual_seize = if seize_amount > position.collateral {
            position.collateral
        } else {
            seize_amount
        };
        
        let xlm_token: Address = env.storage().instance().get(&XLM_TOKEN).unwrap();
        let xlm_client = token::Client::new(&env, &xlm_token);
        xlm_client.transfer(&liquidator, &env.current_contract_address(), &repay_amount);
        
        let sxlm_token: Address = env.storage().instance().get(&SXLM_TOKEN).unwrap();
        let sxlm_client = token::Client::new(&env, &sxlm_token);
        sxlm_client.transfer(&env.current_contract_address(), &liquidator, &actual_seize);
        
        // Update position
        position.borrowed -= repay_amount;
        position.collateral -= actual_seize;
        position.last_update = env.ledger().timestamp();
        Self::set_position(&env, &borrower, &position);
        
        env.events().publish(
            (symbol_short!("liquidate"),),
            (borrower, liquidator, repay_amount, actual_seize)
        );
        
        log!(&env, "Liquidated {} XLM debt, seized {} sXLM", repay_amount, actual_seize);
        Ok(())
    }
    
    // Get user position
    pub fn get_position_info(env: Env, user: Address) -> Position {
        let mut position = Self::get_position(&env, &user);
        Self::apply_interest(&env, &mut position);
        position
    }
    
    // Get health factor
    pub fn get_health_factor(env: Env, user: Address) -> Result<i128, Error> {
        let mut position = Self::get_position(&env, &user);
        Self::apply_interest(&env, &mut position);
        Self::calculate_health_factor(&env, &position)
    }
    
    // Get max borrowable amount
    pub fn get_max_borrow_amount(env: Env, user: Address) -> Result<i128, Error> {
        let mut position = Self::get_position(&env, &user);
        Self::apply_interest(&env, &mut position);
        Self::calculate_max_borrow(&env, &position)
    }
    
    // Get total protocol stats
    pub fn get_protocol_stats(env: Env) -> (i128, i128) {
        let total_collateral: i128 = env.storage().instance().get(&TOTAL_COLLATERAL).unwrap_or(0);
        let total_borrowed: i128 = env.storage().instance().get(&TOTAL_BORROWED).unwrap_or(0);
        (total_collateral, total_borrowed)
    }
    
    
    fn get_position(env: &Env, user: &Address) -> Position {
        let positions: Map<Address, Position> = env.storage()
            .instance()
            .get(&POSITIONS)
            .unwrap_or(Map::new(env));
        
        positions.get(user.clone()).unwrap_or(Position {
            owner: user.clone(),
            collateral: 0,
            borrowed: 0,
            last_update: env.ledger().timestamp(),
        })
    }
    
    fn set_position(env: &Env, user: &Address, position: &Position) {
        let mut positions: Map<Address, Position> = env.storage()
            .instance()
            .get(&POSITIONS)
            .unwrap_or(Map::new(env));
        
        positions.set(user.clone(), position.clone());
        env.storage().instance().set(&POSITIONS, &positions);
    }
    
    fn apply_interest(env: &Env, position: &mut Position) {
        if position.borrowed == 0 {
            return;
        }
        
        let current_time = env.ledger().timestamp();
        let time_elapsed = current_time - position.last_update;
        
        if time_elapsed == 0 {
            return;
        }
        
        // Calculate interest: borrowed * rate * time / year
        let interest = (position.borrowed * BORROW_RATE * time_elapsed as i128) 
            / (10_000 * SECONDS_PER_YEAR as i128);
        
        position.borrowed += interest;
    }
    
    fn calculate_health_factor(env: &Env, position: &Position) -> Result<i128, Error> {
        if position.borrowed == 0 {
            return Ok(i128::MAX); // No debt = infinite health
        }
        
        let collateral_value = Self::get_collateral_value(env, position.collateral)?;
        
        let health = (collateral_value * LIQUIDATION_THRESHOLD * PRECISION) 
            / (position.borrowed * 100);
        
        Ok(health)
    }
    
    fn calculate_max_borrow(env: &Env, position: &Position) -> Result<i128, Error> {
        let collateral_value = Self::get_collateral_value(env, position.collateral)?;
        
        // Max borrow = collateral_value * collateral_factor - already_borrowed
        let max_total = (collateral_value * COLLATERAL_FACTOR) / 100;
        let available = if max_total > position.borrowed {
            max_total - position.borrowed
        } else {
            0
        };
        
        Ok(available)
    }
    
    fn get_collateral_value(env: &Env, sxlm_amount: i128) -> Result<i128, Error> {
        // Get exchange rate from staking pool
        let staking_pool: Address = env.storage().instance().get(&STAKING_POOL).unwrap();
        
       
        let rate = staking_pool_client.get_exchange_rate();
        
        let xlm_value = (sxlm_amount * exchange_rate) / PRECISION;
        Ok(xlm_value)
    }
    
    fn is_initialized(env: &Env) -> bool {
        env.storage().instance().get(&INITIALIZED).unwrap_or(false)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_initialize() {
        let env = Env::default();
        env.mock_all_auths();
        
        let admin = Address::generate(&env);
        let sxlm = Address::generate(&env);
        let xlm = Address::generate(&env);
        let pool = Address::generate(&env);
        
        let contract_id = env.register_contract(None, LendingProtocol);
        let client = LendingProtocolClient::new(&env, &contract_id);
        
        client.initialize(&admin, &sxlm, &xlm, &pool);
        
        let (collateral, borrowed) = client.get_protocol_stats();
        assert_eq!(collateral, 0);
        assert_eq!(borrowed, 0);
        
        println!("✓ Lending Protocol initialized");
    }
    
    #[test]
    fn test_deposit_collateral() {
        let env = Env::default();
        env.mock_all_auths();
        
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let sxlm = Address::generate(&env);
        let xlm = Address::generate(&env);
        let pool = Address::generate(&env);
        
        let contract_id = env.register_contract(None, LendingProtocol);
        let client = LendingProtocolClient::new(&env, &contract_id);
        
        client.initialize(&admin, &sxlm, &xlm, &pool);
        client.deposit_collateral(&user, &1000_0000000);
        
        let position = client.get_position_info(&user);
        assert_eq!(position.collateral, 1000_0000000);
        
        println!("✓ Collateral deposited");
    }
}