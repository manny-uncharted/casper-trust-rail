import { describe, expect, it } from 'vitest';
import { OracleSanctionScreener } from '../src/sanctions/screener.js';
import { MockCasperRpc } from '../src/casper/MockCasperRpc.js';
import { CasperClient } from '../src/casper/CasperClient.js';
import { StaticTBillDataSource } from '../src/oracle/TBillDataSource.js';
import { StaticSanctionOracle } from '../src/sanctions/StaticSanctionOracle.js';
import { createEd25519Attestation } from '../src/attestation/Ed25519Attestation.js';
import { TrustRailAgent } from '../src/agent/TrustRailAgent.js';

const AGENT_ID = 'tbill-oracle';
const PAY_TO = 'account-beneficiary';
const NOW = Date.parse('2026-06-27T12:00:00Z');

function buildAgent(
  options: {
    ratePercent?: number;
    asOf?: string;
    denied?: string[];
  } = {},
): { agent: TrustRailAgent; rpc: MockCasperRpc; casper: CasperClient } {
  const rpc = new MockCasperRpc();
  const casper = new CasperClient(
    rpc,
    { identity: 'hash-identity', reputation: 'hash-reputation', oracle: 'hash-oracle' },
    { sleep: async () => {}, pollIntervalMs: 0 },
  );
  const dataSource = new StaticTBillDataSource([
    {
      feedId: 'us-3m-tbill',
      label: 'US 3-Month T-Bill',
      ratePercent: options.ratePercent ?? 5.31,
      asOf: options.asOf ?? '2026-06-27T08:00:00Z',
      source: 'US Treasury Daily Par Yield',
    },
  ]);
  const screener = new OracleSanctionScreener(
    new StaticSanctionOracle({ denied: options.denied ?? [] }),
  );
  const { signer, verifier } = createEd25519Attestation();

  const agent = new TrustRailAgent({
    agentId: AGENT_ID,
    network: 'casper:casper-test',
    payTo: PAY_TO,
    casper,
    dataSource,
    screener,
    attestationSigner: signer,
    attestationVerifier: verifier,
    now: () => NOW,
  });
  return { agent, rpc, casper };
}

describe('TrustRailAgent — full pipeline', () => {
  it('posts an attested data point on the clean path', async () => {
    const { agent, rpc } = buildAgent();
    const result = await agent.runOnce('us-3m-tbill');

    expect(result.posted).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(result.deployHash).toBeTruthy();
    expect(result.explorerUrl).toContain('testnet.cspr.live');
    expect(result.onChainValue).toBe(5_310_000n);

    // The on-chain post carried the attestation intent hash.
    const [post] = rpc.callsTo('post_data_point');
    expect(post?.args.attestation_hash).toEqual({
      clType: 'string',
      value: result.attestation.intentHash,
    });
    expect(result.attestation.verdict).toBe('allow');
    expect(result.attestation.signature).toBeTruthy();
    expect(result.screening.verdict).toBe('clear');
  });

  it('skips posting when risk escalates (implausible rate)', async () => {
    const { agent, rpc } = buildAgent({ ratePercent: 99 });
    const result = await agent.runOnce('us-3m-tbill');
    expect(result.posted).toBe(false);
    expect(result.skipped).toBe('risk-escalated');
    expect(rpc.callsTo('post_data_point')).toHaveLength(0);
  });

  it('skips posting when the beneficiary is sanctioned', async () => {
    const { agent, rpc } = buildAgent({ denied: [PAY_TO] });
    const result = await agent.runOnce('us-3m-tbill');
    expect(result.posted).toBe(false);
    expect(result.skipped).toBe('sanctions-blocked');
    expect(result.screening.verdict).toBe('blocked');
    expect(rpc.callsTo('post_data_point')).toHaveLength(0);
  });

  it('registers identity on-chain', async () => {
    const { agent, rpc } = buildAgent();
    const reg = await agent.registerIdentity('did:casper:agent');
    expect(reg.deployHash).toBeTruthy();
    expect(rpc.callsTo('register')).toHaveLength(1);
  });

  it('records an accuracy outcome on the reputation contract', async () => {
    const { agent, rpc } = buildAgent();
    const outcome = await agent.recordOutcome(5.31, 5.32);
    expect(outcome.accurate).toBe(true);
    expect(outcome.scoreBps).toBe(10000);
    const [call] = rpc.callsTo('record_outcome');
    expect(call?.args.accurate).toEqual({ clType: 'bool', value: true });
  });
});
