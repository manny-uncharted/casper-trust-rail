# Trust Rail — Demo Video Script (≈3:00)

Screen recording + voiceover, 1080p+. Have ready: this repo open, a terminal,
and three browser tabs pre-loaded with the live deploy transactions (links below).
Upload the final cut to **YouTube** (the DoraHacks form embeds YouTube).

**Title:** `Trust Rail — Autonomous RWA Oracle Agents on Casper | Casper Agentic Buildathon 2026`

---

## 0:00–0:18 · Hook
**On screen:** `assets/logo.svg`, then a generic on-chain yield number with a "?" overlay.
> "This is a yield, posted on-chain, that a DeFi protocol is about to trust with real money. But who posted it? Do they have a track record? Was it screened? Was it even authorized? Today's oracles can't answer that — they just say *trust me*."

## 0:18–0:42 · The problem
**On screen:** one slide — *"Agents are becoming economic actors → trust must be verifiable, not assumed."*
> "Casper's manifest calls itself the trust layer for the agent economy. But as autonomous AI agents start fetching data and moving money, the trust gap gets worse — a rogue or compromised agent can post a fabricated value and everyone downstream consumes it blindly. We built the rail that fixes this."

## 0:42–1:08 · What Trust Rail is
**On screen:** scroll the README architecture diagram + the four-guarantees list.
> "Trust Rail is an autonomous RWA oracle agent on Casper. It publishes verified real-world data — here, US T-bill yields — and every single post carries four guarantees the chain enforces: a verifiable on-chain identity, an accuracy-based reputation that gates who can publish, real-time sanctions screening, and a cryptographic attestation binding the value to a signed policy verdict."

## 1:08–2:00 · Live demo — the agent loop
**Action:** in the terminal, run `bun run demo`. Narrate over the output:
> "Here's the full loop. The agent fetches the yield… risk-assesses it — heuristics plus an LLM that can only *raise* risk, never lower it… screens the counterparty for sanctions, fail-closed… signs an attestation bound to the exact value… and posts it. Notice the attestation hash — that exact hash is what gets stored on-chain as the data point's proof. Then it scores its own accuracy and updates its reputation."

**Zoom each line as it prints:**
```
- risk: post (0) — within band, deviation and freshness nominal
- sanctions: clear (oracle[static-denylist])
posted value: 5310000 (5.31% x 1e6)
attestation hash (on-chain): <hash>
new reputation: 10000 bps
```

## 2:00–2:35 · On-chain proof (LIVE on testnet)
**On screen:** switch to the browser tabs — the three deploy transactions on cspr.live.
> "And it's real on Casper testnet. Three Odra smart contracts — identity, reputation, and the reputation-gated oracle — deployed and live. Here are the deploy transactions. The oracle only accepts a post from a registered agent that clears its reputation floor — that check happens on-chain, contract-to-contract. Consumers read by paying per request over Casper-native x402 — a passive feed turned into machine-to-machine commerce."

**Live links to open on camera:**
- AgentIdentity `hash-50de6c75…03de` — https://testnet.cspr.live/transaction/eb1521e80154f3e6f80b8f93a71c6fbc92b6acf3d2147eb435f82852d2d2f647
- Reputation `hash-d66a18fa…27ba` — https://testnet.cspr.live/transaction/c0a4e255437371a7bee458ed7fb87d49590817d68f146748da3940d3d6f6a4bc
- RwaOracle `hash-7a131614…514b` — https://testnet.cspr.live/transaction/07a7eee25eb6bc2aca57ab4ff9a54004e082d066383d851b8cd9abccb494d83c

> (Optional, if the live `post_data_point` tx is ready: open that transaction too and say "and here's the agent posting an attested T-bill yield on-chain, right now.")

## 2:35–3:00 · Why it wins + close
**On screen:** logo + on-screen text:
```
github.com/manny-uncharted/casper-trust-rail
Casper Agentic Buildathon 2026
```
> "Three Odra contracts live on testnet, an autonomous agent, x402 settlement — the trust layer for the agent economy, running today. Trust Rail. Open source, on Casper."

---

## Recording notes
- Front-load the hook and the live `post`; judges skim. Keep total under 3:00.
- Pre-open the three explorer tabs so there's no loading dead-air on camera.
- `bun run demo` runs fully offline (no keys/network) — safe to record in one take.
- For the full `assets/logo.svg` and `assets/logo-mark.png` (intro/outro), see `assets/`.
- Capture commands that produce clean output: `bun run demo`, optionally `cargo odra test` (shows "9 passed") for a 1-second "tests green" flash.
