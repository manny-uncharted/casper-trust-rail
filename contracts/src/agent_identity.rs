//! Verifiable on-chain identity for autonomous agents.
//!
//! Binds a human-readable `agent_id` (e.g. `"veridex-tbill-oracle"`) to the
//! Casper [`Address`] that controls it, plus a free-form `metadata` string
//! (a DID document, service endpoint, or model card hash). Ownership is proven
//! by the registering account; only that account may rotate the metadata or
//! hand the agent over to a new controller.

use odra::prelude::*;

/// Errors raised by [`AgentIdentity`].
#[odra::odra_error]
pub enum IdentityError {
    /// `register` was called for an `agent_id` that already exists.
    AlreadyRegistered = 1,
    /// A mutating call referenced an `agent_id` that was never registered.
    NotRegistered = 2,
    /// The caller is not the current owner of the agent.
    NotOwner = 3,
}

/// Emitted when a new agent is registered.
#[odra::event]
pub struct AgentRegistered {
    pub agent_id: String,
    pub owner: Address,
}

/// Emitted when an agent's metadata is rotated.
#[odra::event]
pub struct MetadataUpdated {
    pub agent_id: String,
    pub owner: Address,
}

/// Emitted when control of an agent is transferred to a new account.
#[odra::event]
pub struct OwnershipTransferred {
    pub agent_id: String,
    pub previous_owner: Address,
    pub new_owner: Address,
}

/// Registry of agent identities.
#[odra::module(events = [AgentRegistered, MetadataUpdated, OwnershipTransferred])]
pub struct AgentIdentity {
    owners: Mapping<String, Address>,
    metadata: Mapping<String, String>,
    registered: Mapping<String, bool>,
    count: Var<u64>,
}

#[odra::module]
impl AgentIdentity {
    /// Deploy the registry. Takes no arguments — identities are self-sovereign,
    /// registered by whichever account first claims an `agent_id`.
    pub fn init(&mut self) {
        self.count.set(0);
    }

    /// Claim `agent_id` for the calling account. Reverts if already taken.
    pub fn register(&mut self, agent_id: String, metadata: String) {
        if self.registered.get_or_default(&agent_id) {
            self.env().revert(IdentityError::AlreadyRegistered);
        }
        let owner = self.env().caller();
        self.owners.set(&agent_id, owner);
        self.metadata.set(&agent_id, metadata);
        self.registered.set(&agent_id, true);
        self.count.set(self.count.get_or_default().saturating_add(1));
        self.env().emit_event(AgentRegistered { agent_id, owner });
    }

    /// Rotate the metadata for an agent. Owner only.
    pub fn update_metadata(&mut self, agent_id: String, metadata: String) {
        self.assert_owner(&agent_id);
        self.metadata.set(&agent_id, metadata);
        self.env().emit_event(MetadataUpdated {
            agent_id,
            owner: self.env().caller(),
        });
    }

    /// Hand control of an agent to a new account. Owner only.
    pub fn transfer_ownership(&mut self, agent_id: String, new_owner: Address) {
        self.assert_owner(&agent_id);
        let previous_owner = self.env().caller();
        self.owners.set(&agent_id, new_owner);
        self.env().emit_event(OwnershipTransferred {
            agent_id,
            previous_owner,
            new_owner,
        });
    }

    /// Whether `agent_id` has been registered.
    pub fn is_registered(&self, agent_id: String) -> bool {
        self.registered.get_or_default(&agent_id)
    }

    /// The controlling account for `agent_id`, if registered.
    pub fn owner_of(&self, agent_id: String) -> Option<Address> {
        self.owners.get(&agent_id)
    }

    /// The metadata string for `agent_id`, if registered.
    pub fn metadata_of(&self, agent_id: String) -> Option<String> {
        self.metadata.get(&agent_id)
    }

    /// Total number of registered agents.
    pub fn total_agents(&self) -> u64 {
        self.count.get_or_default()
    }

    fn assert_owner(&self, agent_id: &str) {
        let key = agent_id.to_string();
        if !self.registered.get_or_default(&key) {
            self.env().revert(IdentityError::NotRegistered);
        }
        let owner = self.owners.get(&key);
        if owner != Some(self.env().caller()) {
            self.env().revert(IdentityError::NotOwner);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, HostRef, NoArgs};

    #[test]
    fn register_and_read_back() {
        let env = odra_test::env();
        let mut identity = AgentIdentity::deploy(&env, NoArgs);

        let owner = env.get_account(0);
        env.set_caller(owner);
        identity.register("tbill-oracle".to_string(), "did:casper:abc".to_string());

        assert!(identity.is_registered("tbill-oracle".to_string()));
        assert_eq!(identity.owner_of("tbill-oracle".to_string()), Some(owner));
        assert_eq!(
            identity.metadata_of("tbill-oracle".to_string()),
            Some("did:casper:abc".to_string())
        );
        assert_eq!(identity.total_agents(), 1);
    }

    #[test]
    fn double_register_reverts() {
        let env = odra_test::env();
        let mut identity = AgentIdentity::deploy(&env, NoArgs);
        env.set_caller(env.get_account(0));
        identity.register("a".to_string(), "m".to_string());

        let err = identity.try_register("a".to_string(), "m2".to_string());
        assert_eq!(err, Err(IdentityError::AlreadyRegistered.into()));
    }

    #[test]
    fn only_owner_updates_metadata() {
        let env = odra_test::env();
        let mut identity = AgentIdentity::deploy(&env, NoArgs);
        let owner = env.get_account(0);
        let stranger = env.get_account(1);

        env.set_caller(owner);
        identity.register("a".to_string(), "m".to_string());

        env.set_caller(stranger);
        let err = identity.try_update_metadata("a".to_string(), "evil".to_string());
        assert_eq!(err, Err(IdentityError::NotOwner.into()));
    }
}
