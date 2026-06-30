# Deploying Trust Rail to Casper Testnet

End-to-end: build the contracts → deploy + wire them → register the agent → post one attested data point on-chain. The single `post_data_point` deploy is the buildathon's required transaction-producing on-chain component.

## 0. Prerequisites

```bash
# Rust via rustup (NOT Homebrew rust — it has no rustup). The contracts pin a
# nightly toolchain + wasm target in contracts/rust-toolchain.toml, so rustup
# installs them automatically on first build.
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# cargo-odra (build/test orchestrator; targets Odra 2.8)
cargo install cargo-odra --locked

# wasm post-processing tools cargo-odra uses to strip/optimize the wasm:
#   macOS:  brew install wabt binaryen
#   linux:  apt-get install -y wabt binaryen   (or build from source)

# (optional) casper-client for manual inspection
cargo install casper-client
```

Verify:

```bash
cargo odra --version
wasm-strip --version && wasm-opt --version
```

## 1. Validate the contracts (no network needed)

```bash
cd contracts
cargo odra test          # compiles + runs the Rust unit tests on Odra MockVM
cargo odra build         # emits wasm/*.wasm for casper
```

## 2. Make a funded testnet key

```bash
mkdir -p contracts/keys
casper-client keygen contracts/keys           # writes secret_key.pem + public_key_hex
# Fund it from the faucet (paste the public key):
#   https://testnet.cspr.live/tools/faucet
```

## 3. Deploy + wire the three contracts

The Odra livenet binary deploys AgentIdentity and Reputation, then constructs
RwaOracle with their addresses and the reputation floor, printing the hashes.

```bash
cd contracts
export ODRA_CASPER_LIVENET_NODE_ADDRESS=https://node.testnet.cspr.cloud/rpc
export ODRA_CASPER_LIVENET_CHAIN_NAME=casper-test
export ODRA_CASPER_LIVENET_SECRET_KEY_PATH=./keys/secret_key.pem
cargo run --bin deploy --features livenet
```

It prints:

```
TRUSTRAIL_IDENTITY_HASH=hash-...
TRUSTRAIL_REPUTATION_HASH=hash-...
TRUSTRAIL_ORACLE_HASH=hash-...
```

Confirm each on the explorer: `https://testnet.cspr.live/contract/<hash>`.

## 4. Register the agent + post one data point

```bash
cd ..                       # repo root
cp .env.example .env        # then fill in the three hashes above + paths
bun add casper-js-sdk       # the live RPC adapter's optional peer dep
bun run testnet
```

`run-testnet.ts` registers the agent identity, fetches a live T-bill yield,
risk-assesses, sanctions-screens, attests, and posts on-chain — printing the
`post_data_point` deploy hash + explorer URL. **Capture that URL for the demo
and submission.**

## 5. (Optional) score an outcome → on-chain reputation

After the next official yield release, score the post and write the outcome:

```ts
await agent.recordOutcome(postedRatePercent, groundTruthPercent);
```

This calls `Reputation.record_outcome` on-chain and moves the agent's score.

## Troubleshooting

- **`wasm32-unknown-unknown` not found** — you're on Homebrew rust without rustup;
  install rustup (step 0) and re-add the target.
- **Out of gas on deploy** — bump the `env.set_gas(...)` values in `bin/deploy.rs`.
- **`casper-js-sdk` errors in `bun run testnet`** — the facade in
  `src/casper/casperSdkFacade.ts` targets the classic SDK API; reconcile method
  names there with your installed SDK major if they differ.
- **Insufficient balance** — re-request from the faucet; deploys cost ~150–200 CSPR each on testnet.
