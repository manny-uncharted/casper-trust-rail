//! Livenet deploy: ships the three Trust Rail contracts to a real Casper network
//! (testnet) and wires them together, printing the contract hashes to paste into
//! `.env` for the agent.
//!
//! Run (from `contracts/`):
//!
//! ```bash
//! export ODRA_CASPER_LIVENET_NODE_ADDRESS=https://node.testnet.cspr.cloud/rpc
//! export ODRA_CASPER_LIVENET_CHAIN_NAME=casper-test
//! export ODRA_CASPER_LIVENET_SECRET_KEY_PATH=./keys/secret_key.pem   # funded
//! cargo run --bin deploy --features livenet
//! ```
//!
//! Order matters: AgentIdentity and Reputation deploy first, then RwaOracle is
//! constructed with their addresses and the reputation floor.

use casper_trust_rail_contracts::{
    AgentIdentity, Reputation, ReputationInitArgs, RwaOracle, RwaOracleInitArgs,
};
use odra::host::{Deployer, HostRef, NoArgs};

/// Reputation floor (bps) a publisher must clear to post. 5000 = neutral.
const MIN_REPUTATION_BPS: u32 = 5_000;

fn main() {
    let env = odra_casper_livenet_env::env();

    // The deploying account is also the agent operator and the reputation updater.
    let operator = env.caller();

    // --- AgentIdentity ---
    env.set_gas(150_000_000_000u64); // 150 CSPR; tune per network conditions.
    let identity = AgentIdentity::deploy(&env, NoArgs);
    println!("AgentIdentity deployed: {}", identity.address().to_string());

    // --- Reputation (operator is the authorized outcome updater) ---
    env.set_gas(150_000_000_000u64);
    let reputation = Reputation::deploy(&env, ReputationInitArgs { updater: operator });
    println!("Reputation   deployed: {}", reputation.address().to_string());

    // --- RwaOracle (wired to the two above) ---
    env.set_gas(200_000_000_000u64);
    let oracle = RwaOracle::deploy(
        &env,
        RwaOracleInitArgs {
            identity_contract: identity.address(),
            reputation_contract: reputation.address(),
            min_reputation_bps: MIN_REPUTATION_BPS,
        },
    );
    println!("RwaOracle    deployed: {}", oracle.address().to_string());

    println!("\n# Paste into .env:");
    println!("TRUSTRAIL_IDENTITY_HASH={}", identity.address().to_string());
    println!("TRUSTRAIL_REPUTATION_HASH={}", reputation.address().to_string());
    println!("TRUSTRAIL_ORACLE_HASH={}", oracle.address().to_string());
}
