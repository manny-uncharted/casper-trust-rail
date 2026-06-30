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

## Network

- Chain: `casper-test` (Casper 2.0)
- Node: `https://node.testnet.casper.network`
- Framework: Odra 2.8

To reproduce or post data through the agent, see [DEPLOY.md](DEPLOY.md).
