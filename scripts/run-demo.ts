/**
 * Trust Rail end-to-end demo (offline).
 *
 * Runs the full agent pipeline against {@link MockCasperRpc} so it works with no
 * keys, no funds, and no network — ideal for the demo video's "here's the loop"
 * segment and for CI. Swap `MockCasperRpc` for `RealCasperRpc` (see
 * `scripts/deploy-contracts.ts`) to drive the same flow on Casper testnet.
 *
 *   bun run scripts/run-demo.ts
 */

import {
  CasperClient,
  HeuristicRiskAssessor,
  LlmRiskAssessor,
  MockCasperRpc,
  StaticSanctionOracle,
  OracleSanctionScreener,
  StaticTBillDataSource,
  TrustRailAgent,
  createEd25519Attestation,
  createGeminiComplete,
  geminiAvailable,
  type RiskAssessor,
} from '../src/index.js';


const AGENT_ID = 'veridex-tbill-oracle';

async function main(): Promise<void> {
  // Offline demo (MockCasperRpc). Addresses are the real testnet deployment
  // (see DEPLOYED.md); for a live on-chain run use `bun run testnet`.
  const rpc = new MockCasperRpc({ network: 'casper-test' });
  const casper = new CasperClient(rpc, {
    identity: 'hash-50de6c7535ef4196db67904a7c5a6fa5a1d56199e6100edd8c7b042fdf0b03de',
    reputation: 'hash-d66a18fa40dfc17e199bcbde6aff02ade40ffd4fd1b8adfe022c1ba5145427ba',
    oracle: 'hash-7a1316142309897f674c5be6c86ac3dfa21869c79aa59738716ac480fdee514b',
  });

  const dataSource = new StaticTBillDataSource([
    {
      feedId: 'us-3m-tbill',
      label: 'US 3-Month T-Bill',
      ratePercent: 5.31,
      // A published yield is "as of" a prior close, not the current instant.
      asOf: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
      source: 'US Treasury Daily Par Yield Curve',
    },
  ]);

  const screener = new OracleSanctionScreener(
    new StaticSanctionOracle({ denied: ['account-ofac-listed'] }),
  );
  const { signer, verifier } = createEd25519Attestation();

  // The agent's risk brain: Gemini (LLM) over a deterministic heuristic floor
  // when GEMINI_API_KEY is set, otherwise the heuristic alone.
  const riskAssessor: RiskAssessor = geminiAvailable()
    ? new LlmRiskAssessor(createGeminiComplete())
    : new HeuristicRiskAssessor();
  console.log(
    `risk brain: ${geminiAvailable() ? 'Gemini (LLM) + heuristic floor' : 'heuristic (set GEMINI_API_KEY to enable Gemini)'}`,
  );

  const agent = new TrustRailAgent({
    agentId: AGENT_ID,
    network: 'casper:casper-test',
    payTo: 'account-veridex-treasury',
    casper,
    dataSource,
    screener,
    riskAssessor,
    attestationSigner: signer,
    attestationVerifier: verifier,
  });

  log('1. Register on-chain identity');
  const reg = await agent.registerIdentity(`did:casper:${AGENT_ID}`);
  console.log(`   identity deploy: ${reg.deployHash}`);
  console.log(`   ${reg.explorerUrl}\n`);

  log('2. Run the oracle pipeline (fetch -> assess -> screen -> attest -> post)');
  const result = await agent.runOnce('us-3m-tbill');
  for (const note of result.notes) console.log(`   - ${note}`);
  if (result.posted) {
    console.log(`\n   posted value: ${result.onChainValue} (5.31% x 1e6)`);
    console.log(`   attestation hash (on-chain): ${result.attestation.intentHash}`);
    console.log(`   post deploy: ${result.deployHash}`);
    console.log(`   ${result.explorerUrl}\n`);
  } else {
    console.log(`\n   SKIPPED: ${result.skipped}\n`);
  }

  log('3. Score the post against ground truth -> on-chain reputation update');
  const outcome = await agent.recordOutcome(5.31, 5.315);
  console.log(`   accurate: ${outcome.accurate} (err ${outcome.errorPercent}pp)`);
  console.log(`   new reputation: ${outcome.scoreBps} bps`);
  console.log(`   reputation deploy: ${outcome.deployHash}\n`);

  log('Recorded on-chain calls (MockCasperRpc)');
  for (const call of rpc.calls) {
    console.log(`   - ${call.entryPoint} -> ${call.contractHash}`);
  }
}

function log(title: string): void {
  console.log(`\n=== ${title} ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
