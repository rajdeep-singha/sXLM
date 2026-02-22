#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, Address, Env, Map, String, Symbol, Vec,
    token, log, symbol_short,
};

const VOTING_PERIOD: u64 = 604800; // 7 days in seconds
const EXECUTION_DELAY: u64 = 172800; // 2 days in seconds
const QUORUM_PERCENTAGE: i128 = 10; // 10% of total supply
const PRECISION: i128 = 100;


#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    ProposalNotFound = 5,
    ProposalNotActive = 6,
    ProposalNotPassed = 7,
    ProposalAlreadyExecuted = 8,
    VotingPeriodEnded = 9,
    VotingPeriodNotEnded = 10,
    AlreadyVoted = 11,
    QuorumNotReached = 12,
    ExecutionDelayNotMet = 13,
}



const ADMIN: Symbol = Symbol::short("ADMIN");
const SXLM_TOKEN: Symbol = Symbol::short("SXLM");
const PROPOSALS: Symbol = Symbol::short("PROPS");
const NEXT_PROPOSAL_ID: Symbol = Symbol::short("NEXTID");
const VOTES: Symbol = Symbol::short("VOTES");
const INITIALIZED: Symbol = Symbol::short("INIT");



#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalStatus {
    Active,
    Passed,
    Failed,
    Executed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VoteChoice {
    For,
    Against,
    Abstain,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub title: String,
    pub description: String,
    pub status: ProposalStatus,
    pub votes_for: i128,
    pub votes_against: i128,
    pub votes_abstain: i128,
    pub created_at: u64,
    pub voting_ends_at: u64,
    pub execution_time: u64,
    pub executed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Vote {
    pub voter: Address,
    pub proposal_id: u64,
    pub choice: VoteChoice,
    pub voting_power: i128,
    pub timestamp: u64,
}



#[contract]
pub struct Governance;

#[contractimpl]
impl Governance {
    

    pub fn initialize(
        env: Env,
        admin: Address,
        sxlm_token: Address,
    ) -> Result<(), Error> {
        if Self::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        
        admin.require_auth();
        
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&SXLM_TOKEN, &sxlm_token);
        env.storage().instance().set(&NEXT_PROPOSAL_ID, &0u64);
        env.storage().instance().set(&INITIALIZED, &true);
        
        log!(&env, "Governance: Initialized");
        Ok(())
    }
    
    
    pub fn create_proposal(
        env: Env,
        proposer: Address,
        title: String,
        description: String,
    ) -> Result<u64, Error> {
        proposer.require_auth(); 
        
        // Check proposer has sXLM (minimum balance check could be added)
        let sxlm_token: Address = env.storage().instance().get(&SXLM_TOKEN).unwrap();
        let token_client = token::Client::new(&env, &sxlm_token);
        let balance = token_client.balance(&proposer);
        
        if balance == 0 {
            return Err(Error::Unauthorized);
        }
        
        let proposal_id: u64 = env.storage().instance().get(&NEXT_PROPOSAL_ID).unwrap();
        let current_time = env.ledger().timestamp();
        
        let proposal = Proposal {
            id: proposal_id,
            proposer: proposer.clone(),
            title: title.clone(),
            description,
            status: ProposalStatus::Active,
            votes_for: 0,
            votes_against: 0,
            votes_abstain: 0,
            created_at: current_time,
            voting_ends_at: current_time + VOTING_PERIOD,
            execution_time: current_time + VOTING_PERIOD + EXECUTION_DELAY,
            executed: false,
        };
        
        Self::set_proposal(&env, &proposal);
        env.storage().instance().set(&NEXT_PROPOSAL_ID, &(proposal_id + 1));
        
        env.events().publish(
            (symbol_short!("propose"),),
            (proposal_id, proposer, title)
        );
        
        log!(&env, "Proposal {} created", proposal_id);
        Ok(proposal_id)
    }
    
    // Vote on a proposal
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        choice: VoteChoice,
    ) -> Result<(), Error> {
        voter.require_auth();
        
        let mut proposal = Self::get_proposal(&env, proposal_id)?;
        
       
        if proposal.status != ProposalStatus::Active {
            return Err(Error::ProposalNotActive);
        }
        
       
        let current_time = env.ledger().timestamp();
        if current_time > proposal.voting_ends_at {
            return Err(Error::VotingPeriodEnded);
        }
        
        
        if Self::has_voted(&env, &voter, proposal_id) {
            return Err(Error::AlreadyVoted);
        }
        
        // Get voting power (sXLM balance)
        let sxlm_token: Address = env.storage().instance().get(&SXLM_TOKEN).unwrap();
        let token_client = token::Client::new(&env, &sxlm_token);
        let voting_power = token_client.balance(&voter);
        
        if voting_power == 0 {
            return Err(Error::InvalidAmount);
        }
        
        // Record vote
        let vote = Vote {
            voter: voter.clone(),
            proposal_id,
            choice: choice.clone(),
            voting_power,
            timestamp: current_time,
        };
        
        Self::record_vote(&env, &vote);
        
        // Update proposal vote counts
        match choice {
            VoteChoice::For => proposal.votes_for += voting_power,
            VoteChoice::Against => proposal.votes_against += voting_power,
            VoteChoice::Abstain => proposal.votes_abstain += voting_power,
        }
        
        Self::set_proposal(&env, &proposal);
        
        env.events().publish(
            (symbol_short!("vote"),),
            (proposal_id, voter, voting_power)
        );
        
        log!(&env, "Voted on proposal {} with {} power", proposal_id, voting_power);
        Ok(())
    }
    
    // Finalize proposal after voting period
    pub fn finalize_proposal(env: Env, proposal_id: u64) -> Result<(), Error> {
        let mut proposal = Self::get_proposal(&env, proposal_id)?;
        
        let current_time = env.ledger().timestamp();
        if current_time <= proposal.voting_ends_at {
            return Err(Error::VotingPeriodNotEnded);
        }
        
        if proposal.status != ProposalStatus::Active {
            return Err(Error::ProposalNotActive);
        }
        
        // Get total sXLM supply for quorum calculation
        let sxlm_token: Address = env.storage().instance().get(&SXLM_TOKEN).unwrap();
        let token_client = token::Client::new(&env, &sxlm_token);
        let total_supply = token_client.total_supply();
        
        // Calculate quorum threshold
        let quorum_needed = (total_supply * QUORUM_PERCENTAGE) / 100;
        let total_votes = proposal.votes_for + proposal.votes_against + proposal.votes_abstain;
        
        // Determine if proposal passed
        let passed = total_votes >= quorum_needed && proposal.votes_for > proposal.votes_against;
        
        proposal.status = if passed {
            ProposalStatus::Passed
        } else {
            ProposalStatus::Failed
        };
        
        Self::set_proposal(&env, &proposal);
        
        env.events().publish(
            (symbol_short!("finalize"),),
            (proposal_id, passed)
        );
        
        log!(&env, "Proposal {} finalized: {}", proposal_id, if passed { "PASSED" } else { "FAILED" });
        Ok(())
    }
    
    // Execute a passed proposal (admin or automated)
    pub fn execute_proposal(env: Env, proposal_id: u64) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&ADMIN).unwrap();
        admin.require_auth();
        
        let mut proposal = Self::get_proposal(&env, proposal_id)?;
        
        if proposal.status != ProposalStatus::Passed {
            return Err(Error::ProposalNotPassed);
        }
        
        // Check execution delay met
        let current_time = env.ledger().timestamp();
        if current_time < proposal.execution_time {
            return Err(Error::ExecutionDelayNotMet);
        }
        
        if proposal.executed {
            return Err(Error::ProposalAlreadyExecuted);
        }
        
        proposal.executed = true;
        proposal.status = ProposalStatus::Executed;
        Self::set_proposal(&env, &proposal);
        
        // have to implement the actual execution logic
       
        
        env.events().publish(
            (symbol_short!("execute"),),
            proposal_id
        );
        
        log!(&env, "Proposal {} executed", proposal_id);
        Ok(())
    }
    
    pub fn cancel_proposal(env: Env, proposal_id: u64) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&ADMIN).unwrap();
        admin.require_auth();
        
        let mut proposal = Self::get_proposal(&env, proposal_id)?;
        
        proposal.status = ProposalStatus::Cancelled;
        Self::set_proposal(&env, &proposal);
        
        env.events().publish(
            (symbol_short!("cancel"),),
            proposal_id
        );
        
        Ok(())
    }
    
    pub fn get_proposal_info(env: Env, proposal_id: u64) -> Result<Proposal, Error> {
        Self::get_proposal(&env, proposal_id)
    }
    
    pub fn get_all_proposals(env: Env) -> Vec<Proposal> {
        let proposals: Map<u64, Proposal> = env.storage()
            .instance()
            .get(&PROPOSALS)
            .unwrap_or(Map::new(&env));
        
        let mut result = Vec::new(&env);
        for (_, proposal) in proposals.iter() {
            result.push_back(proposal);
        }
        result
    }
    
    pub fn get_active_proposals(env: Env) -> Vec<Proposal> {
        let proposals: Map<u64, Proposal> = env.storage()
            .instance()
            .get(&PROPOSALS)
            .unwrap_or(Map::new(&env));
        
        let mut result = Vec::new(&env);
        for (_, proposal) in proposals.iter() {
            if proposal.status == ProposalStatus::Active {
                result.push_back(proposal);
            }
        }
        result
    }
    
    pub fn get_user_vote(env: Env, user: Address, proposal_id: u64) -> Option<Vote> {
        Self::get_vote(&env, &user, proposal_id)
    }
    
    pub fn get_stats(env: Env) -> (u64, u64) {
        let next_id: u64 = env.storage().instance().get(&NEXT_PROPOSAL_ID).unwrap_or(0);
        let total_proposals = next_id;
        
        let active = Self::get_active_proposals(&env).len() as u64;
        
        (total_proposals, active)
    }
    
    
    fn get_proposal(env: &Env, proposal_id: u64) -> Result<Proposal, Error> {
        let proposals: Map<u64, Proposal> = env.storage()
            .instance()
            .get(&PROPOSALS)
            .unwrap_or(Map::new(env));
        
        proposals.get(proposal_id).ok_or(Error::ProposalNotFound)
    }
    
    fn set_proposal(env: &Env, proposal: &Proposal) {
        let mut proposals: Map<u64, Proposal> = env.storage()
            .instance()
            .get(&PROPOSALS)
            .unwrap_or(Map::new(env));
        
        proposals.set(proposal.id, proposal.clone());
        env.storage().instance().set(&PROPOSALS, &proposals);
    }
    
    fn record_vote(env: &Env, vote: &Vote) {
        let mut votes: Map<(Address, u64), Vote> = env.storage()
            .instance()
            .get(&VOTES)
            .unwrap_or(Map::new(env));
        
        votes.set((vote.voter.clone(), vote.proposal_id), vote.clone());
        env.storage().instance().set(&VOTES, &votes);
    }
    
    fn has_voted(env: &Env, voter: &Address, proposal_id: u64) -> bool {
        let votes: Map<(Address, u64), Vote> = env.storage()
            .instance()
            .get(&VOTES)
            .unwrap_or(Map::new(env));
        
        votes.contains_key((voter.clone(), proposal_id))
    }
    
    fn get_vote(env: &Env, voter: &Address, proposal_id: u64) -> Option<Vote> {
        let votes: Map<(Address, u64), Vote> = env.storage()
            .instance()
            .get(&VOTES)
            .unwrap_or(Map::new(env));
        
        votes.get((voter.clone(), proposal_id))
    }
    
    fn is_initialized(env: &Env) -> bool {
        env.storage().instance().get(&INITIALIZED).unwrap_or(false)
    }
}

