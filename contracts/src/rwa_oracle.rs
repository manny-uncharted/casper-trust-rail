//! The RWA oracle: publish / read / consumer.
//!
//! Agents publish attested real-world-asset data points (e.g. the 3-month
//! T-bill yield). A post is accepted only when, at block time:
//!
//! 1. the `agent_id` is registered in [`AgentIdentity`], and
//! 2. `caller` is the account that controls it, and
//! 3. the agent's [`Reputation`] clears the configured floor.
//!
//! Every point carries an `attestation_hash` — the SHA-256 of the off-chain
//! policy attestation that authorised it — so a consumer can match an on-chain
//! value to the exact signed verdict and evidence bundle that produced it.
//!
//! Downstream DeFi reads via [`RwaOracle::latest`] (free view) or the paid
//! [`RwaOracle::consume`] entry point, which is what a Casper-native x402
//! pay-per-read wraps.

use crate::agent_identity::AgentIdentityContractRef;
use crate::reputation::ReputationContractRef;
use odra::prelude::*;
use odra::ContractRef;

/// A single published data point.
#[odra::odra_type]
pub struct FeedPoint {
    /// The value, scaled by `decimals` (see [`RwaOracle::decimals`]). For yields
    /// we use basis points × 1e4, e.g. 5.31% -> 53_100.
    pub value: u64,
    /// Human-readable provenance, e.g. `"US Treasury Daily Par Yield"`.
    pub source: String,
    /// SHA-256 (hex) of the off-chain policy attestation that authorised this post.
    pub attestation_hash: String,
    /// The publishing agent.
    pub agent_id: String,
    /// Block time (ms) at which the point was accepted.
    pub timestamp: u64,
    /// Monotonic per-feed sequence number.
    pub sequence: u64,
}

/// Errors raised by [`RwaOracle`].
#[odra::odra_error]
pub enum OracleError {
    /// Caller is not the admin.
    NotAdmin = 1,
    /// The `agent_id` is not registered in the identity contract.
    UnregisteredAgent = 2,
    /// Caller does not control the `agent_id` it is posting under.
    NotAgentOwner = 3,
    /// The agent's reputation is below the configured floor.
    InsufficientReputation = 4,
    /// `consume`/`latest` referenced a feed with no data yet.
    NoData = 5,
}

/// Emitted on every accepted data point.
#[odra::event]
pub struct DataPointPosted {
    pub feed_id: String,
    pub agent_id: String,
    pub value: u64,
    pub sequence: u64,
    pub attestation_hash: String,
    pub agent_score_bps: u32,
}

/// Emitted on every paid consumer read.
#[odra::event]
pub struct DataConsumed {
    pub feed_id: String,
    pub consumer: Address,
    pub sequence: u64,
}

/// The publish/read/consumer RWA oracle.
#[odra::module(events = [DataPointPosted, DataConsumed])]
pub struct RwaOracle {
    admin: Var<Address>,
    identity_contract: Var<Address>,
    reputation_contract: Var<Address>,
    min_reputation_bps: Var<u32>,
    decimals: Var<u8>,
    feeds: Mapping<String, FeedPoint>,
    sequence: Mapping<String, u64>,
    read_count: Mapping<String, u64>,
}

#[odra::module]
impl RwaOracle {
    /// Deploy the oracle, wiring it to the identity and reputation contracts and
    /// setting the reputation floor (basis points) a publisher must clear.
    pub fn init(
        &mut self,
        identity_contract: Address,
        reputation_contract: Address,
        min_reputation_bps: u32,
    ) {
        self.admin.set(self.env().caller());
        self.identity_contract.set(identity_contract);
        self.reputation_contract.set(reputation_contract);
        self.min_reputation_bps.set(min_reputation_bps);
        self.decimals.set(8);
    }

    /// Publish an attested data point. See the module docs for the three checks.
    pub fn post_data_point(
        &mut self,
        feed_id: String,
        value: u64,
        source: String,
        attestation_hash: String,
        agent_id: String,
    ) {
        let caller = self.env().caller();

        let identity = self.identity_ref();
        if !identity.is_registered(agent_id.clone()) {
            self.env().revert(OracleError::UnregisteredAgent);
        }
        if identity.owner_of(agent_id.clone()) != Some(caller) {
            self.env().revert(OracleError::NotAgentOwner);
        }

        let score_bps = self.reputation_ref().score_of(agent_id.clone());
        if score_bps < self.min_reputation_bps.get_or_default() {
            self.env().revert(OracleError::InsufficientReputation);
        }

        let sequence = self.sequence.get_or_default(&feed_id).saturating_add(1);
        let point = FeedPoint {
            value,
            source,
            attestation_hash: attestation_hash.clone(),
            agent_id: agent_id.clone(),
            timestamp: self.env().get_block_time(),
            sequence,
        };
        self.feeds.set(&feed_id, point);
        self.sequence.set(&feed_id, sequence);

        self.env().emit_event(DataPointPosted {
            feed_id,
            agent_id,
            value,
            sequence,
            attestation_hash,
            agent_score_bps: score_bps,
        });
    }

    /// Latest point for `feed_id`, or `None`. Free, non-mutating view.
    pub fn latest(&self, feed_id: String) -> Option<FeedPoint> {
        self.feeds.get(&feed_id)
    }

    /// Paid consumer read: records consumption and returns the latest point.
    /// Reverts if the feed has no data. This is the entry point a Casper x402
    /// pay-per-read settles against.
    pub fn consume(&mut self, feed_id: String) -> FeedPoint {
        let point = match self.feeds.get(&feed_id) {
            Some(p) => p,
            None => self.env().revert(OracleError::NoData),
        };
        let reads = self.read_count.get_or_default(&feed_id).saturating_add(1);
        self.read_count.set(&feed_id, reads);
        self.env().emit_event(DataConsumed {
            feed_id,
            consumer: self.env().caller(),
            sequence: point.sequence,
        });
        point
    }

    /// Number of paid reads served for `feed_id`.
    pub fn read_count_of(&self, feed_id: String) -> u64 {
        self.read_count.get_or_default(&feed_id)
    }

    /// The reputation floor (bps) a publisher must clear.
    pub fn min_reputation_bps(&self) -> u32 {
        self.min_reputation_bps.get_or_default()
    }

    /// Fixed-point decimals used for `value`.
    pub fn decimals(&self) -> u8 {
        self.decimals.get_or_default()
    }

    /// Update the reputation floor. Admin only.
    pub fn set_min_reputation_bps(&mut self, min_reputation_bps: u32) {
        self.assert_admin();
        self.min_reputation_bps.set(min_reputation_bps);
    }

    fn identity_ref(&self) -> AgentIdentityContractRef {
        AgentIdentityContractRef::new(
            self.env(),
            self.identity_contract.get().unwrap_or_revert(&self.env()),
        )
    }

    fn reputation_ref(&self) -> ReputationContractRef {
        ReputationContractRef::new(
            self.env(),
            self.reputation_contract.get().unwrap_or_revert(&self.env()),
        )
    }

    fn assert_admin(&self) {
        if self.env().caller() != self.admin.get().unwrap_or_revert(&self.env()) {
            self.env().revert(OracleError::NotAdmin);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_identity::{AgentIdentity, AgentIdentityHostRef};
    use crate::reputation::{Reputation, ReputationHostRef, ReputationInitArgs};
    use odra::host::{Deployer, HostRef, NoArgs};

    struct Rig {
        env: odra::host::HostEnv,
        identity: AgentIdentityHostRef,
        reputation: ReputationHostRef,
        oracle: RwaOracleHostRef,
        agent: Address,
    }

    fn setup(min_bps: u32) -> Rig {
        let env = odra_test::env();
        let agent = env.get_account(0);
        let updater = env.get_account(1);

        let identity = AgentIdentity::deploy(&env, NoArgs);
        let reputation = Reputation::deploy(&env, ReputationInitArgs { updater });
        let oracle = RwaOracle::deploy(
            &env,
            RwaOracleInitArgs {
                identity_contract: identity.address(),
                reputation_contract: reputation.address(),
                min_reputation_bps: min_bps,
            },
        );

        env.set_caller(agent);
        let mut identity_mut = identity;
        identity_mut.register("tbill".to_string(), "did:casper:agent".to_string());

        Rig {
            env,
            identity: identity_mut,
            reputation,
            oracle,
            agent,
        }
    }

    #[test]
    fn registered_reputable_agent_can_post_and_consumer_reads() {
        let mut rig = setup(5_000);
        rig.env.set_caller(rig.agent);
        rig.oracle.post_data_point(
            "us-3m".to_string(),
            53_100,
            "US Treasury Daily Par Yield".to_string(),
            "deadbeef".to_string(),
            "tbill".to_string(),
        );

        let latest = rig.oracle.latest("us-3m".to_string()).unwrap();
        assert_eq!(latest.value, 53_100);
        assert_eq!(latest.sequence, 1);
        assert_eq!(latest.attestation_hash, "deadbeef".to_string());

        let consumer = rig.env.get_account(3);
        rig.env.set_caller(consumer);
        let read = rig.oracle.consume("us-3m".to_string());
        assert_eq!(read.value, 53_100);
        assert_eq!(rig.oracle.read_count_of("us-3m".to_string()), 1);
    }

    #[test]
    fn unregistered_agent_is_rejected() {
        let mut rig = setup(5_000);
        rig.env.set_caller(rig.agent);
        let err = rig.oracle.try_post_data_point(
            "us-3m".to_string(),
            1,
            "s".to_string(),
            "h".to_string(),
            "ghost".to_string(),
        );
        assert_eq!(err, Err(OracleError::UnregisteredAgent.into()));
    }

    #[test]
    fn low_reputation_is_rejected() {
        // Floor of 6000 bps; drive the agent below it, then expect a block.
        let mut rig = setup(6_000);
        let updater = rig.env.get_account(1);
        rig.env.set_caller(updater);
        // 1 correct / 3 total = 3333 bps < 6000.
        rig.reputation.record_outcome("tbill".to_string(), true);
        rig.reputation.record_outcome("tbill".to_string(), false);
        rig.reputation.record_outcome("tbill".to_string(), false);

        rig.env.set_caller(rig.agent);
        let err = rig.oracle.try_post_data_point(
            "us-3m".to_string(),
            1,
            "s".to_string(),
            "h".to_string(),
            "tbill".to_string(),
        );
        assert_eq!(err, Err(OracleError::InsufficientReputation.into()));
    }
}
