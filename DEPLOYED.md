# Live Deployment — Casper Testnet

Trust Rail's three contracts are **deployed and live on Casper testnet** (`casper-test`),
deployed via the Odra livenet binary (`cargo run --bin deploy --features livenet`).

## Contract addresses

| Contract | Address (contract package hash) |
|---|---|
| **AgentIdentity** | `hash-50de6c7535ef4196db67904a7c5a6fa5a1d56199e6100edd8c7b042fdf0b03de` |
| **Reputation** | `hash-d66a18fa40dfc17e199bcbde6aff02ade40ffd4fd1b8adfe022c1ba5145427ba` |
| **RwaOracle** | `hash-7a1316142309897f674c5be6c86ac3dfa21869c79aa59738716ac480fdee514b` |

The `RwaOracle` is wired at deploy time to the `AgentIdentity` and `Reputation`
addresses above (its `init` stores them for the on-chain reputation gate), with a
reputation floor of 5000 bps.

## Deployment transactions (cspr.live testnet explorer)

| Contract | Transaction |
|---|---|
| AgentIdentity | https://testnet.cspr.live/transaction/eb1521e80154f3e6f80b8f93a71c6fbc92b6acf3d2147eb435f82852d2d2f647 |
| Reputation | https://testnet.cspr.live/transaction/c0a4e255437371a7bee458ed7fb87d49590817d68f146748da3940d3d6f6a4bc |
| RwaOracle | https://testnet.cspr.live/transaction/07a7eee25eb6bc2aca57ab4ff9a54004e082d066383d851b8cd9abccb494d83c |

## Agent in action (live on-chain)

The agent has registered its identity and posted attested T-bill data points to
the live oracle. Run it yourself with `bun run testnet` (the TypeScript agent
runs the fetch → risk → sanctions → attest pipeline, then writes on-chain).

| Action | Transaction |
|---|---|
| `register` (agent identity `veridex-tbill-oracle`) | https://testnet.cspr.live/transaction/d3a2ab1366b42732f28c33bb22aa71330738f93843e07ef434570af55680cf02 |
| `post_data_point` (attested 5.31% T-bill yield) | https://testnet.cspr.live/transaction/e2b78e52d5e3128f0cef9f845e9839a42425e5421db57b6b39b94ed98bd01284 |
| `post_data_point` (agent-driven, `bun run testnet`) | https://testnet.cspr.live/transaction/6881d0a479778ac7e7edf083d899144db8e14ae10d43088627b7e4e22e041260 |

On-chain state read back from the oracle: `feeds["us-3m-tbill"] = { value: 5310000 (5.31%), agent: "veridex-tbill-oracle", attestation_hash: "45470551136d7081c6ab4c13e31a235aa9efec6bd034ecb699af899e0285a806" }` — the stored `attestation_hash` is the SHA-256 of the agent's signed policy verdict.

## Network

- Chain: `casper-test` (Casper 2.0)
- Node: `https://node.testnet.casper.network`
- Framework: Odra 2.8

To reproduce or post data through the agent, see [DEPLOY.md](DEPLOY.md).
