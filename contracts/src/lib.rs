//! Trust Rail on-chain contracts for the Casper Network.
//!
//! Three minimal, composable Odra modules that together form a trust-minimised
//! RWA oracle:
//!
//! * [`AgentIdentity`] — a registry binding a human-readable `agent_id` to the
//!   Casper account that controls it (verifiable on-chain identity).
//! * [`Reputation`] — an accuracy-weighted reputation score per agent, moved by
//!   an authorised updater as data points are scored against ground truth.
//! * [`RwaOracle`] — the publish/read/consumer oracle. It accepts attested data
//!   points only from registered agents whose reputation clears a floor, and
//!   exposes them to downstream DeFi consumers (with a paid `consume` path that
//!   pairs with Casper-native x402).
//!
//! Targets Odra 2.8+ (`cargo odra build` / `cargo odra test`).

#![cfg_attr(not(test), no_std)]
#![cfg_attr(not(test), no_main)]
extern crate alloc;

mod agent_identity;
mod reputation;
mod rwa_oracle;

pub use agent_identity::{AgentIdentity, IdentityError};
pub use reputation::{Reputation, ReputationError, ReputationInitArgs};
pub use rwa_oracle::{FeedPoint, OracleError, RwaOracle, RwaOracleInitArgs};
