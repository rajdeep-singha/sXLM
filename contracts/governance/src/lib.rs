#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, BytesN, Env, String};

const BPS_DENOMINATOR: i128 = 10_000;
const MIN_PROPOSAL_BALANCE: i128 = 100_0000000; // 100 sXLM minimum to create proposal

// ---------- TTL constants ----------
const INSTANCE_LIFETIME_THRESHOLD: u32 = 100_800; // ~7 days
const INSTANCE_BUMP_AMOUNT: u32 = 518_400;        // bump to ~30 days
const PROPOSAL_LIFETIME_THRESHOLD: u32 = 518_400; // ~30 days
const PROPOSAL_BUMP_AMOUNT: u32 = 3_110_400;      // bump to ~180 days

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    SxlmToken,
    VotingPeriodLedgers,
    QuorumBps,
    Initialized,
    ProposalCount,
    Proposal(u64),
    Vote(u64, Address), // (proposal_id, voter) → bool
    /// sXLM escrowed by a voter for a proposal, returned after voting closes.
    VoteWeight(u64, Address),
    // Governable parameter storage (result of executed proposals)
    Param(String),
    /// Ledgers that must pass between voting closing and execution.
    ExecutionDelayLedgers,
}

#[derive(Clone)]
#[contracttype]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub param_key: String,
    pub new_value: String,
    pub votes_for: i128,
    pub votes_against: i128,
    pub start_ledger: u32,
    pub end_ledger: u32,
    /// Earliest ledger at which this proposal may execute. Voting closing and
    /// execution are deliberately separated so a passing proposal can be seen
    /// and reacted to before it takes effect.
    pub eta: u32,
    /// Share supply at creation. Quorum is measured against this rather than a
    /// figure an admin can set, and freezing it stops a proposal's own
    /// mint/burn activity from moving the bar it has to clear.
    pub supply_snapshot: i128,
    pub executed: bool,
}

// --- Storage helpers ---

fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

fn extend_proposal(env: &Env, id: u64) {
    let key = DataKey::Proposal(id);
    if env.storage().persistent().has(&key) {
        env.storage()
            .persistent()
            .extend_ttl(&key, PROPOSAL_LIFETIME_THRESHOLD, PROPOSAL_BUMP_AMOUNT);
    }
}

fn extend_vote(env: &Env, proposal_id: u64, voter: &Address) {
    let key = DataKey::Vote(proposal_id, voter.clone());
    if env.storage().persistent().has(&key) {
        env.storage()
            .persistent()
            .extend_ttl(&key, PROPOSAL_LIFETIME_THRESHOLD, PROPOSAL_BUMP_AMOUNT);
    }
}

fn read_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

fn read_sxlm_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::SxlmToken).unwrap()
}

fn read_voting_period(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::VotingPeriodLedgers)
        .unwrap_or(17280u32) // ~24 hours
}

fn read_execution_delay(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ExecutionDelayLedgers)
        .unwrap_or(17280u32) // ~24 hours
}

fn read_vote_weight(env: &Env, proposal_id: u64, voter: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::VoteWeight(proposal_id, voter.clone()))
        .unwrap_or(0)
}

fn read_quorum_bps(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::QuorumBps)
        .unwrap_or(1000) // 10%
}

fn next_proposal_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ProposalCount)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::ProposalCount, &(id + 1));
    id
}

fn read_proposal(env: &Env, id: u64) -> Proposal {
    let key = DataKey::Proposal(id);
    let proposal: Proposal = env.storage().persistent().get(&key).unwrap();
    // Extend TTL on read
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_LIFETIME_THRESHOLD, PROPOSAL_BUMP_AMOUNT);
    proposal
}

fn write_proposal(env: &Env, proposal: &Proposal) {
    let key = DataKey::Proposal(proposal.id);
    env.storage().persistent().set(&key, proposal);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_LIFETIME_THRESHOLD, PROPOSAL_BUMP_AMOUNT);
}

fn has_voted(env: &Env, proposal_id: u64, voter: &Address) -> bool {
    let key = DataKey::Vote(proposal_id, voter.clone());
    let val: bool = env.storage().persistent().get(&key).unwrap_or(false);
    if val {
        env.storage()
            .persistent()
            .extend_ttl(&key, PROPOSAL_LIFETIME_THRESHOLD, PROPOSAL_BUMP_AMOUNT);
    }
    val
}

fn set_voted(env: &Env, proposal_id: u64, voter: &Address) {
    let key = DataKey::Vote(proposal_id, voter.clone());
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_LIFETIME_THRESHOLD, PROPOSAL_BUMP_AMOUNT);
}

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    /// Initialize the governance contract.
    pub fn initialize(
        env: Env,
        admin: Address,
        sxlm_token: Address,
        voting_period_ledgers: u32,
        quorum_bps: u32,
        execution_delay_ledgers: u32,
    ) {
        let already: bool = env.storage().instance().get(&DataKey::Initialized).unwrap_or(false);
        if already {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::SxlmToken, &sxlm_token);
        env.storage().instance().set(&DataKey::VotingPeriodLedgers, &voting_period_ledgers);
        env.storage().instance().set(&DataKey::QuorumBps, &(quorum_bps as i128));
        assert!(quorum_bps > 0, "quorum must be greater than zero");
        env.storage()
            .instance()
            .set(&DataKey::ExecutionDelayLedgers, &execution_delay_ledgers);
        extend_instance(&env);
    }

    /// Upgrade the contract WASM. Only callable by admin.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin = read_admin(&env);
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Bump instance TTL — can be called by anyone to keep contract alive.
    pub fn bump_instance(env: Env) {
        extend_instance(&env);
    }

    /// Create a new governance proposal. Proposer must hold minimum sXLM balance.
    pub fn create_proposal(
        env: Env,
        proposer: Address,
        param_key: String,
        new_value: String,
    ) -> u64 {
        proposer.require_auth();
        extend_instance(&env);

        // Check minimum sXLM balance
        let sxlm = read_sxlm_token(&env);
        let balance = token::Client::new(&env, &sxlm).balance(&proposer);
        assert!(
            balance >= MIN_PROPOSAL_BALANCE,
            "insufficient sXLM to create proposal"
        );

        let id = next_proposal_id(&env);
        let current_ledger = env.ledger().sequence();
        let voting_period = read_voting_period(&env);
        let end_ledger = current_ledger + voting_period;
        let supply_snapshot = SxlmSupplyClient::new(&env, &sxlm).total_supply();
        assert!(supply_snapshot > 0, "no shares in circulation");

        let proposal = Proposal {
            id,
            proposer: proposer.clone(),
            param_key: param_key.clone(),
            new_value: new_value.clone(),
            votes_for: 0,
            votes_against: 0,
            start_ledger: current_ledger,
            end_ledger,
            eta: end_ledger + read_execution_delay(&env),
            supply_snapshot,
            executed: false,
        };

        write_proposal(&env, &proposal);

        env.events().publish(
            (soroban_sdk::symbol_short!("propose"),),
            (id, proposer, param_key),
        );

        id
    }

    /// Vote on a proposal by escrowing sXLM for the length of the vote.
    ///
    /// The previous build weighted votes by a live `balance()` call, so the
    /// same tokens could be bought, voted with, and sold inside one ledger —
    /// and could vote on every proposal at once. Escrow makes the voter hold
    /// the position for the voting period instead of borrowing it for an
    /// instant. Tokens are returned by `unlock_vote` once voting closes.
    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: bool, amount: i128) {
        voter.require_auth();
        extend_instance(&env);
        extend_vote(&env, proposal_id, &voter);

        let mut proposal = read_proposal(&env, proposal_id);

        assert!(!proposal.executed, "proposal already executed");
        let current_ledger = env.ledger().sequence();
        assert!(
            current_ledger <= proposal.end_ledger,
            "voting period has ended"
        );
        assert!(!has_voted(&env, proposal_id, &voter), "already voted");
        assert!(amount > 0, "vote weight must be positive");

        // Escrow the shares. This is also the balance check: a voter without
        // the tokens cannot complete the transfer.
        let sxlm = read_sxlm_token(&env);
        token::Client::new(&env, &sxlm).transfer(
            &voter,
            &env.current_contract_address(),
            &amount,
        );

        env.storage().persistent().set(
            &DataKey::VoteWeight(proposal_id, voter.clone()),
            &amount,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::VoteWeight(proposal_id, voter.clone()),
            PROPOSAL_LIFETIME_THRESHOLD,
            PROPOSAL_BUMP_AMOUNT,
        );

        if support {
            proposal.votes_for += amount;
        } else {
            proposal.votes_against += amount;
        }

        set_voted(&env, proposal_id, &voter);
        write_proposal(&env, &proposal);

        env.events().publish(
            (soroban_sdk::symbol_short!("voted"),),
            (proposal_id, voter, support, amount),
        );
    }

    /// Reclaim escrowed sXLM once voting on a proposal has closed.
    pub fn unlock_vote(env: Env, voter: Address, proposal_id: u64) {
        voter.require_auth();
        extend_instance(&env);

        let proposal = read_proposal(&env, proposal_id);
        assert!(
            env.ledger().sequence() > proposal.end_ledger,
            "voting period has not ended"
        );

        let weight = read_vote_weight(&env, proposal_id, &voter);
        assert!(weight > 0, "nothing to unlock");

        env.storage()
            .persistent()
            .remove(&DataKey::VoteWeight(proposal_id, voter.clone()));

        let sxlm = read_sxlm_token(&env);
        token::Client::new(&env, &sxlm).transfer(
            &env.current_contract_address(),
            &voter,
            &weight,
        );

        env.events().publish(
            (soroban_sdk::symbol_short!("unlocked"),),
            (proposal_id, voter, weight),
        );
    }

    /// Execute a proposal if quorum met and passed.
    /// Stores the new parameter value on-chain for the admin/backend to read and propagate.
    pub fn execute_proposal(env: Env, proposal_id: u64) {
        extend_instance(&env);
        extend_proposal(&env, proposal_id);

        let mut proposal = read_proposal(&env, proposal_id);

        assert!(!proposal.executed, "proposal already executed");

        let current_ledger = env.ledger().sequence();
        assert!(
            current_ledger > proposal.end_ledger,
            "voting period not ended"
        );
        // Timelock. A proposal that has passed is visible for the delay before
        // it can take effect, which is the whole point of having one.
        assert!(current_ledger >= proposal.eta, "timelock has not elapsed");

        // Quorum against the supply snapshot taken at creation. This check is
        // unconditional: the previous build skipped it entirely whenever the
        // admin-set reference supply was zero, which was its initial value.
        let total_votes = proposal.votes_for + proposal.votes_against;
        assert!(total_votes > 0, "no votes cast");

        let quorum_bps = read_quorum_bps(&env);
        let min_votes_required = proposal.supply_snapshot * quorum_bps / BPS_DENOMINATOR;
        assert!(total_votes >= min_votes_required, "quorum not met");

        // Must pass: votes_for > votes_against
        assert!(
            proposal.votes_for > proposal.votes_against,
            "proposal did not pass"
        );

        // Store the approved parameter value on-chain
        let param_key = DataKey::Param(proposal.param_key.clone());
        env.storage().persistent().set(
            &param_key,
            &proposal.new_value,
        );
        env.storage()
            .persistent()
            .extend_ttl(&param_key, PROPOSAL_LIFETIME_THRESHOLD, PROPOSAL_BUMP_AMOUNT);

        proposal.executed = true;
        write_proposal(&env, &proposal);

        env.events().publish(
            (soroban_sdk::symbol_short!("executed"),),
            (proposal_id, proposal.param_key, proposal.new_value),
        );
    }

    // --- Views ---

    pub fn get_proposal(env: Env, id: u64) -> Proposal {
        extend_instance(&env);
        read_proposal(&env, id)
    }

    pub fn proposal_count(env: Env) -> u64 {
        extend_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0)
    }

    pub fn get_vote_count(env: Env, id: u64) -> (i128, i128) {
        extend_instance(&env);
        let proposal = read_proposal(&env, id);
        (proposal.votes_for, proposal.votes_against)
    }

    /// sXLM a voter has escrowed on a proposal.
    pub fn get_vote_weight(env: Env, proposal_id: u64, voter: Address) -> i128 {
        extend_instance(&env);
        read_vote_weight(&env, proposal_id, &voter)
    }

    /// Ledgers between voting closing and execution becoming possible.
    pub fn execution_delay(env: Env) -> u32 {
        extend_instance(&env);
        read_execution_delay(&env)
    }

    /// Earliest ledger at which a proposal may execute.
    pub fn proposal_eta(env: Env, id: u64) -> u32 {
        extend_instance(&env);
        read_proposal(&env, id).eta
    }

    /// Read an approved governance parameter value.
    ///
    /// Note: no other contract reads these values yet. Executing a proposal
    /// records the approved value here; applying it to the vault or the lending
    /// market still requires those contracts to accept governance as their
    /// admin, which is a mainnet ownership transfer and is deliberately not
    /// bundled into this change.
    pub fn get_param(env: Env, key: String) -> String {
        extend_instance(&env);
        let param_key = DataKey::Param(key);
        let val: String = env.storage()
            .persistent()
            .get(&param_key)
            .unwrap_or(String::from_str(&env, ""));
        // Extend TTL if it exists
        if env.storage().persistent().has(&param_key) {
            env.storage()
                .persistent()
                .extend_ttl(&param_key, PROPOSAL_LIFETIME_THRESHOLD, PROPOSAL_BUMP_AMOUNT);
        }
        val
    }
}

use soroban_sdk::contractclient;

/// The SEP-41 token interface has no total supply, so quorum reads it from the
/// sXLM contract's own entrypoint.
#[contractclient(name = "SxlmSupplyClient")]
pub trait SxlmSupplyInterface {
    fn total_supply(env: Env) -> i128;
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{symbol_short, Env, Map, String};

    /// sXLM stand-in: transferable like the real token and, unlike a Stellar
    /// asset contract, able to report total supply for the quorum check.
    #[contract]
    pub struct MockSxlm;

    #[contractimpl]
    impl MockSxlm {
        pub fn mint(env: Env, to: Address, amount: i128) {
            let mut b: Map<Address, i128> = env.storage().instance()
                .get(&symbol_short!("BAL")).unwrap_or(Map::new(&env));
            b.set(to.clone(), b.get(to).unwrap_or(0) + amount);
            env.storage().instance().set(&symbol_short!("BAL"), &b);
            let sup: i128 = env.storage().instance()
                .get(&symbol_short!("SUP")).unwrap_or(0);
            env.storage().instance().set(&symbol_short!("SUP"), &(sup + amount));
        }

        pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
            from.require_auth();
            let mut b: Map<Address, i128> = env.storage().instance()
                .get(&symbol_short!("BAL")).unwrap_or(Map::new(&env));
            let f = b.get(from.clone()).unwrap_or(0);
            if f < amount {
                panic!("insufficient balance");
            }
            b.set(from, f - amount);
            b.set(to.clone(), b.get(to).unwrap_or(0) + amount);
            env.storage().instance().set(&symbol_short!("BAL"), &b);
        }

        pub fn balance(env: Env, id: Address) -> i128 {
            let b: Map<Address, i128> = env.storage().instance()
                .get(&symbol_short!("BAL")).unwrap_or(Map::new(&env));
            b.get(id).unwrap_or(0)
        }

        pub fn total_supply(env: Env) -> i128 {
            env.storage().instance().get(&symbol_short!("SUP")).unwrap_or(0)
        }
    }

    struct Fixture<'a> {
        env: Env,
        gov: GovernanceContractClient<'a>,
        sxlm: MockSxlmClient<'a>,
        proposer: Address,
        voter: Address,
    }

    /// 100 ledgers of voting, 10% quorum, 50 ledgers of timelock.
    fn setup(env: &Env) -> Fixture<'_> {
        env.mock_all_auths();

        let admin = Address::generate(env);
        let proposer = Address::generate(env);
        let voter = Address::generate(env);

        let sxlm_id = env.register_contract(None, MockSxlm);
        let gov_id = env.register_contract(None, GovernanceContract);

        let gov = GovernanceContractClient::new(env, &gov_id);
        gov.initialize(&admin, &sxlm_id, &100, &1000, &50);

        let sxlm = MockSxlmClient::new(env, &sxlm_id);
        sxlm.mint(&proposer, &10_000_0000000);
        sxlm.mint(&voter, &5_000_0000000);

        Fixture { env: env.clone(), gov, sxlm, proposer, voter }
    }

    fn advance(env: &Env, ledgers: u32) {
        env.ledger().with_mut(|l| l.sequence_number += ledgers);
    }

    fn propose(f: &Fixture) -> u64 {
        f.gov.create_proposal(
            &f.proposer,
            &String::from_str(&f.env, "collateral_factor"),
            &String::from_str(&f.env, "7500"),
        )
    }

    #[test]
    fn initializes_with_a_timelock() {
        let env = Env::default();
        let f = setup(&env);
        assert_eq!(f.gov.proposal_count(), 0);
        assert_eq!(f.gov.execution_delay(), 50);
    }

    #[test]
    fn proposal_records_eta_and_supply_snapshot() {
        let env = Env::default();
        let f = setup(&env);
        let id = propose(&f);

        let p = f.gov.get_proposal(&id);
        assert_eq!(p.eta, p.end_ledger + 50);
        // Both participants' holdings, frozen at creation.
        assert_eq!(p.supply_snapshot, 15_000_0000000);
    }

    #[test]
    fn voting_escrows_the_shares() {
        let env = Env::default();
        let f = setup(&env);
        let id = propose(&f);

        let before = f.sxlm.balance(&f.voter);
        f.gov.vote(&f.voter, &id, &true, &5_000_0000000);

        assert_eq!(f.sxlm.balance(&f.voter), before - 5_000_0000000);
        assert_eq!(f.gov.get_vote_weight(&id, &f.voter), 5_000_0000000);
        assert_eq!(f.gov.get_vote_count(&id), (5_000_0000000, 0));
    }

    /// The attack the old build allowed: weight came from a live balance read,
    /// so shares could be voted and then moved on in the same ledger. Escrow
    /// means the second voter simply does not have them.
    #[test]
    #[should_panic(expected = "insufficient balance")]
    fn the_same_shares_cannot_vote_twice() {
        let env = Env::default();
        let f = setup(&env);
        let id = propose(&f);

        f.gov.vote(&f.voter, &id, &true, &5_000_0000000);

        // Voter tries to pass their (now escrowed) shares to an accomplice.
        let accomplice = Address::generate(&env);
        f.sxlm.transfer(&f.voter, &accomplice, &5_000_0000000);
        f.gov.vote(&accomplice, &id, &true, &5_000_0000000);
    }

    #[test]
    #[should_panic(expected = "already voted")]
    fn a_voter_cannot_vote_twice() {
        let env = Env::default();
        let f = setup(&env);
        let id = propose(&f);
        f.gov.vote(&f.voter, &id, &true, &1_000_0000000);
        f.gov.vote(&f.voter, &id, &true, &1_000_0000000);
    }

    #[test]
    fn escrow_is_returned_after_voting_closes() {
        let env = Env::default();
        let f = setup(&env);
        let id = propose(&f);

        let before = f.sxlm.balance(&f.voter);
        f.gov.vote(&f.voter, &id, &true, &5_000_0000000);
        advance(&env, 101);
        f.gov.unlock_vote(&f.voter, &id);

        assert_eq!(f.sxlm.balance(&f.voter), before);
        assert_eq!(f.gov.get_vote_weight(&id, &f.voter), 0);
    }

    #[test]
    #[should_panic(expected = "voting period has not ended")]
    fn escrow_is_locked_until_voting_closes() {
        let env = Env::default();
        let f = setup(&env);
        let id = propose(&f);
        f.gov.vote(&f.voter, &id, &true, &5_000_0000000);
        f.gov.unlock_vote(&f.voter, &id);
    }

    #[test]
    #[should_panic(expected = "timelock has not elapsed")]
    fn execution_waits_for_the_timelock() {
        let env = Env::default();
        let f = setup(&env);
        let id = propose(&f);
        f.gov.vote(&f.proposer, &id, &true, &10_000_0000000);

        // Voting is over, but the delay has not passed.
        advance(&env, 101);
        f.gov.execute_proposal(&id);
    }

    #[test]
    fn execution_succeeds_once_the_timelock_elapses() {
        let env = Env::default();
        let f = setup(&env);
        let id = propose(&f);
        f.gov.vote(&f.proposer, &id, &true, &10_000_0000000);

        advance(&env, 151);
        f.gov.execute_proposal(&id);

        assert_eq!(
            f.gov.get_param(&String::from_str(&env, "collateral_factor")),
            String::from_str(&env, "7500")
        );
        assert!(f.gov.get_proposal(&id).executed);
    }

    /// Quorum used to be skipped whenever the admin-set reference supply was
    /// zero, which is what it was initialised to. It is now unconditional.
    #[test]
    #[should_panic(expected = "quorum not met")]
    fn quorum_is_enforced() {
        let env = Env::default();
        let f = setup(&env);
        let id = propose(&f);

        // 10% of a 15,000 sXLM supply is 1,500. This is well under.
        f.gov.vote(&f.voter, &id, &true, &100_0000000);

        advance(&env, 151);
        f.gov.execute_proposal(&id);
    }

    #[test]
    #[should_panic(expected = "proposal did not pass")]
    fn a_defeated_proposal_cannot_execute() {
        let env = Env::default();
        let f = setup(&env);
        let id = propose(&f);

        f.gov.vote(&f.proposer, &id, &false, &10_000_0000000);
        f.gov.vote(&f.voter, &id, &true, &5_000_0000000);

        advance(&env, 151);
        f.gov.execute_proposal(&id);
    }

    #[test]
    fn unset_params_read_empty() {
        let env = Env::default();
        let f = setup(&env);
        assert_eq!(
            f.gov.get_param(&String::from_str(&env, "nothing")),
            String::from_str(&env, "")
        );
    }
}
