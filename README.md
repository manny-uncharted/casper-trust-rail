<p align="center">
  <img src="./assets/logo.svg" alt="Trust Rail — Autonomous RWA oracle agents on Casper" width="620"/>
</p>

<h1 align="center">Trust Rail</h1>
<p align="center"><b>Autonomous RWA oracle agents you can actually trust — live on Casper.</b></p>

<p align="center">
  <a href="DEPLOYED.md">✅ Live on Casper testnet</a> ·
  <a href="https://github.com/manny-uncharted/casper-trust-rail">Open source (MIT)</a> ·
  Casper Agentic Buildathon 2026 ·
  Odra 2.8 · x402 · Gemini
</p>

---

## The 30‑second version

Tokenized real‑world assets are the institutional story of 2026 treasuries, private credit, money‑market funds moving on‑chain. But every one of them rests on a fragile assumption: that the **data bridging the real asset to the chain is trustworthy.** That bridge is an oracle, and a bad or tampered feed is how you end up with *tokens circulating without real reserves.*

Now add autonomous AI agents as the things *fetching and posting* that data, and the trust gap gets worse, not better. Who is this agent? Has it ever been right? Was the number screened? Was it even authorized or did a compromised process just sign it?

**Trust Rail answers all four, on‑chain.** It's an autonomous AI agent that publishes verified RWA data to Casper where **every post carries a verifiable identity, an accuracy‑based reputation the chain enforces, real‑time sanctions screening, and a cryptographic attestation** binding the value to a signed policy verdict. Consumers read it by paying per request over Casper‑native **x402** a passive feed turned into trust‑minimized machine‑to‑machine commerce.

It is Casper's manifest  *"the trust layer for the agent economy"*  made real and running. The reference asset is **US T‑bill / treasury yields**; the rail is asset‑agnostic.

```
fetch → risk-assess (Gemini) → sanctions-screen → attest → post on-chain → confirm → (later) score → reputation
```

## Why this is needed (not just nice)

RWA oracles must deliver *valuations, NAV, rate feeds, credit data, and proof‑of‑reserve attestations* with near‑perfect reliability and **verifiable provenance** because the core problem of RWAs is the dissonance between deterministic code and a messy, probabilistic real world. The industry's answer so far is "trust a big provider." Trust Rail's answer is different and stronger: **don't trust the publisher verify them.** Every number is traceable to *who* posted it, *what their track record is*, and *the exact signed verdict that authorized it*. That's the missing primitive for an oracle layer operated by autonomous agents.

## It's live see for yourself

All three contracts are **deployed and live** on Casper testnet (`casper-test`, Casper 2.0), and the agent has registered its identity and posted attested data points.

| Contract                | Address (package hash)  | Deploy tx                                                                                                   |
| ----------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| **AgentIdentity** | `hash-50de6c75…03de` | [↗](https://testnet.cspr.live/transaction/eb1521e80154f3e6f80b8f93a71c6fbc92b6acf3d2147eb435f82852d2d2f647) |
| **Reputation**    | `hash-d66a18fa…27ba` | [↗](https://testnet.cspr.live/transaction/c0a4e255437371a7bee458ed7fb87d49590817d68f146748da3940d3d6f6a4bc) |
| **RwaOracle**     | `hash-7a131614…514b` | [↗](https://testnet.cspr.live/transaction/07a7eee25eb6bc2aca57ab4ff9a54004e082d066383d851b8cd9abccb494d83c) |

**The agent in action:** [`register` ↗](https://testnet.cspr.live/transaction/d3a2ab1366b42732f28c33bb22aa71330738f93843e07ef434570af55680cf02) · [`post_data_point` ↗](https://testnet.cspr.live/transaction/6881d0a479778ac7e7edf083d899144db8e14ae10d43088627b7e4e22e041260) (stores `value=5310000` = 5.31%, `attestation_hash=45470551…`). Full list + addresses in **[DEPLOYED.md](DEPLOYED.md)**.

Run it yourself: `bun run demo` (offline, one command) or `bun run testnet` (drives a real on‑chain post).

## The four guarantees, enforced by the chain

1. **Verifiable on‑chain identity.** The agent owns its `agent_id` in a registry; only the controlling account can publish under it.
2. **Accuracy‑based reputation.** A basis‑point score, moved as the agent's past values are checked against ground truth. The oracle **refuses posts from agents below a reputation floor** a cross‑contract check at write time. A low‑accuracy agent literally cannot publish.
3. **Real‑time sanctions screening.** Counterparties are screened before every post, **fail‑closed** (unreachable screener ⇒ blocked, not waved through).
4. **Cryptographic attestation.** A signed policy verdict is bound to the exact value by SHA‑256, and that hash is stored on‑chain next to the data point. Anyone can verify *why* a value was posted, *by whom*, *with what track record* and a compromised host can't force an unauthorized post.

## The AI: a Gemini‑powered risk brain that can't be talked into a bad post

The agent's "should I post this?" decision is a two‑layer brain:

- a **deterministic heuristic floor** (plausibility band, deviation‑from‑last, staleness) that is always in effect, and
- **Google Gemini** (`gemini-2.5-flash`) layered on top for real judgment spotting a spoofed source, an implausible move, a suspicious revision.

The key safety property: **the LLM can only *raise* risk severity, never lower the floor.** Gemini can escalate a post to *flag* or *escalate*, but it can never talk the agent into publishing something the rules rejected. Set `GEMINI_API_KEY` to enable it; without a key the agent runs on the deterministic floor. (`@google/genai` is an optional dependency, loaded lazily.)

## How it works

```
┌──────────────────────────── TrustRailAgent (TypeScript) ────────────────────────────┐
│  TBillDataSource ─▶ RiskAssessor ─▶ Sanctions ─▶ PostAttestation ─▶ on-chain write  │
│   (off-chain RWA)   (Gemini + floor) (fail-closed)  (signed verdict)                │
└───────────────────────────────────────────────────────┬─────────────────────────────┘
                                Odra livenet / casper-js-sdk · CSPR.cloud
            ┌───────────────────────────────────────────┼───────────────────────────────┐
            ▼                                           ▼                               ▼
   AgentIdentity (Odra)                        Reputation (Odra)                 RwaOracle (Odra)
   register / owner_of                         record_outcome / score_of         post_data_point / consume
                                                          ▲                                │
                                                          └──────── reputation gate ◀──────┘
                                       x402: pay-per-read settlement (CSPR.cloud Facilitator)
```

**On‑chain — three Odra (Rust) contracts:** `agent_identity` (verifiable identity), `reputation` (accuracy score in bps, starts neutral at 5000), `rwa_oracle` (accepts a post only from a registered, reputation‑clearing agent; stores value + `attestation_hash`; serves consumers via a free `latest` view and a paid `consume` entry point).

**Off‑chain — the agent (TypeScript):** `TrustRailAgent` orchestration · `RiskAssessor` (heuristic + Gemini) · `CasperClient` over a swappable RPC · `CasperX402Facilitator` + `ExactPaymentSigner` (EIP‑712 `exact` scheme) · native, self‑contained attestation + sanctions primitives.

## Why Casper

- **x402 native.** Casper shipped the first WebAssembly‑native L1 with live HTTP micropayments Trust Rail uses it for pay‑per‑read settlement (`exact` scheme, EIP‑712, CEP‑18).
- **Odra.** Three contracts built and tested with `cargo odra` (Odra 2.8), reputation‑gated cross‑contract calls included.
- **RWA + agents is Casper's thesis.** This is the trust‑minimized RWA oracle with on‑chain identity + reputation, exactly the manifest's machine‑economy direction shipped.

## Why it wins

| Criterion                          | How Trust Rail hits it                                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Working smart contracts**  | Three Odra contracts**live on testnet** ([addresses + txs](DEPLOYED.md)), cross‑contract reputation gate, **9 passing Rust tests**.                                        |
| **Use of AI / Agentic**      | A genuine autonomous loop with a**Gemini** risk brain that can only raise risk, never lower the deterministic floor; fetch → assess → decide → attest → post → self‑score. |
| **Innovation**               | Reputation‑gated, attestation‑bound RWA oracle every on‑chain value is traceable to its signed verdict, its author, and its track record.                                          |
| **Real‑world (DeFi & RWA)** | Posts treasury yields a DeFi protocol consumes via a paid`consume` entry point; x402 makes it machine‑to‑machine commerce.                                                         |
| **Technical execution**      | Self‑contained, no private deps.**37 TS tests + 9 contract tests green**, clean `tsc`, CJS+ESM+DTS build, live on‑chain demo.                                                |
| **Long‑term plans**         | Built by the Veridex team as a real, ongoing commitment agent identity + reputation is a primitive the whole Casper RWA ecosystem can build on.                                       |

## Quick start

```bash
bun install
bun run test          # 37 tests
bun run lint          # tsc --noEmit, clean
bun run demo          # full agent loop, offline (no keys/network)

# enable the Gemini risk brain (optional):
bun add @google/genai && export GEMINI_API_KEY=...   # then bun run demo
```

`bun run demo` walks the whole loop — fetch → risk → sanctions → attest → post → reputation — and prints the on‑chain attestation hash.

## Run it live on testnet

```bash
cp .env.example .env          # already points at the live deployment + public node
bun run testnet               # TS agent intelligence -> real on-chain attested post
```

`bun run testnet` runs the agent's full off‑chain pipeline in TypeScript, then writes the attested data point on‑chain through the deployed, reputation‑gated oracle, printing the transaction link. Full deploy‑from‑scratch guide in **[DEPLOY.md](DEPLOY.md)**; demo‑video script in **[DEMO.md](DEMO.md)**.

## Roadmap

Trust Rail is the productizable core of a trust layer for autonomous agents: any agent, any RWA, earning a public on‑chain reputation and settling via x402. Next: private credit and tokenized‑invoice feeds, a multi‑agent consensus check before posting, and opening the reputation primitive so DeFi protocols can *require* a minimum oracle track record on‑chain.

## License

MIT