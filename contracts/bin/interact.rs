//! Livenet interaction: drives the agent's on-chain actions against the already
//! deployed Trust Rail contracts (register identity → post an attested data point
//! → read it back). This is the on-chain executor behind the live demo; the
//! off-chain agent intelligence (fetch / risk-assess / attest) runs in TypeScript
//! and passes the computed value + attestation hash in via env.
//!
//! Because Odra deployed these contracts, loading and calling them here uses the
//! exact generated ABI — no manual CLValue/runtime wrangling.
//!
//! Run (from `contracts/`, same env as the deploy plus the contract hashes):
//!
//! ```bash
//! export TRUSTRAIL_IDENTITY_HASH=hash-...
//! export TRUSTRAIL_ORACLE_HASH=hash-...
//! export FEED_ID=us-3m-tbill VALUE=5310000 \
//!        SOURCE="US Treasury Daily Par Yield" ATTESTATION_HASH=<hex> \
//!        TRUSTRAIL_AGENT_ID=veridex-tbill-oracle
//! cargo run --bin interact --features livenet
//! ```

use casper_trust_rail_contracts::{AgentIdentity, RwaOracle};
use odra::host::HostRefLoader;
use odra::prelude::Address;
use std::str::FromStr;

fn env_var(key: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| panic!("missing env {key}"))
}

fn addr(key: &str) -> Address {
    Address::from_str(&env_var(key)).unwrap_or_else(|e| panic!("bad {key}: {e:?}"))
}

fn main() {
    let env = odra_casper_livenet_env::env();

    let mut identity = AgentIdentity::load(&env, addr("TRUSTRAIL_IDENTITY_HASH"));
    let mut oracle = RwaOracle::load(&env, addr("TRUSTRAIL_ORACLE_HASH"));

    let agent_id =
        std::env::var("TRUSTRAIL_AGENT_ID").unwrap_or_else(|_| "veridex-tbill-oracle".to_string());
    let feed_id = std::env::var("FEED_ID").unwrap_or_else(|_| "us-3m-tbill".to_string());
    let value: u64 = std::env::var("VALUE")
        .unwrap_or_else(|_| "5310000".to_string())
        .parse()
        .expect("VALUE must be u64 (percent x 1e6)");
    let source = std::env::var("SOURCE")
        .unwrap_or_else(|_| "US Treasury Daily Par Yield".to_string());
    let attestation_hash = env_var("ATTESTATION_HASH");

    // 1. Register the agent identity (idempotent: skip if already registered, so a
    //    re-run produces no failed transaction).
    if identity.is_registered(agent_id.clone()) {
        println!("agent identity already registered: {agent_id}");
    } else {
        env.set_gas(12_000_000_000u64);
        identity.register(agent_id.clone(), format!("did:casper:{agent_id}"));
        println!("registered agent identity: {agent_id}");
    }

    // 2. Post the attested data point on-chain (cross-contract identity + reputation
    //    gate runs inside the oracle).
    env.set_gas(120_000_000_000u64);
    oracle.post_data_point(
        feed_id.clone(),
        value,
        source,
        attestation_hash.clone(),
        agent_id.clone(),
    );
    println!("posted data point: feed={feed_id} value={value} attestation={attestation_hash}");

    // 3. Read it back (free view).
    if let Some(point) = oracle.latest(feed_id.clone()) {
        println!(
            "on-chain latest[{}]: value={} sequence={} agent={} attestation={}",
            feed_id, point.value, point.sequence, point.agent_id, point.attestation_hash
        );
    }
}
