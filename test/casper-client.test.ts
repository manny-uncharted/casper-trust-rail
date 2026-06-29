import { describe, expect, it } from 'vitest';
import { MockCasperRpc } from '../src/casper/MockCasperRpc.js';
import { CasperClient, type TrustRailContracts } from '../src/casper/CasperClient.js';

const contracts: TrustRailContracts = {
  identity: 'hash-identity',
  reputation: 'hash-reputation',
  oracle: 'hash-oracle',
};

function setup(rpc = new MockCasperRpc()): { rpc: MockCasperRpc; client: CasperClient } {
  const c = new CasperClient(rpc, contracts, { sleep: async () => {}, pollIntervalMs: 0 });
  return { rpc, client: c };
}

describe('CasperClient', () => {
  it('builds post_data_point with typed runtime args', async () => {
    const { rpc, client } = setup();
    const res = await client.postDataPoint({
      feedId: 'us-3m-tbill',
      value: 5_310_000n,
      source: 'US Treasury',
      attestationHash: 'abc123',
      agentId: 'tbill-oracle',
    });
    expect(res.deployHash).toHaveLength(64);

    const [call] = rpc.callsTo('post_data_point');
    expect(call?.contractHash).toBe('hash-oracle');
    expect(call?.args.value).toEqual({ clType: 'u64', value: 5_310_000n });
    expect(call?.args.agent_id).toEqual({ clType: 'string', value: 'tbill-oracle' });
  });

  it('confirms a successful deploy', async () => {
    const { client } = setup();
    const res = await client.registerAgent('tbill-oracle', 'did:casper:x');
    const status = await client.confirm(res);
    expect(status.state).toBe('success');
  });

  it('throws when a deploy fails', async () => {
    const { client } = setup(new MockCasperRpc({ failDeploys: true }));
    const res = await client.recordOutcome('tbill-oracle', true);
    await expect(client.confirm(res)).rejects.toThrow(/failed/);
  });

  it('reads a feed point back from seeded state', async () => {
    const rpc = new MockCasperRpc();
    rpc.seedQuery(
      { contractHash: 'hash-oracle', dictionaryName: 'feeds', dictionaryItemKey: 'us-3m-tbill' },
      {
        value: '5310000',
        source: 'US Treasury',
        attestation_hash: 'abc123',
        agent_id: 'tbill-oracle',
        timestamp: '1700000000000',
        sequence: '1',
      },
    );
    const { client } = setup(rpc);
    const point = await client.latest('us-3m-tbill');
    expect(point?.value).toBe(5_310_000n);
    expect(point?.attestationHash).toBe('abc123');
    expect(point?.sequence).toBe(1n);
  });

  it('returns the testnet explorer url', () => {
    const { client } = setup();
    expect(client.explorerUrl('deadbeef')).toBe('https://testnet.cspr.live/deploy/deadbeef');
  });
});
