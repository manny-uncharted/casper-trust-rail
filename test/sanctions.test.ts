import { describe, expect, it } from 'vitest';
import { OracleSanctionScreener } from '../src/sanctions/screener.js';
import { StaticSanctionOracle } from '../src/sanctions/StaticSanctionOracle.js';

const cp = (address: string) => ({
  id: `casper:${address}`,
  chain: 'casper:casper-test',
  address,
});

describe('StaticSanctionOracle + OracleSanctionScreener', () => {
  it('clears an unlisted counterparty', async () => {
    const oracle = new StaticSanctionOracle({ denied: ['account-bad'] });
    const screener = new OracleSanctionScreener(oracle);
    const result = await screener.screen(cp('account-good'));
    expect(result.verdict).toBe('clear');
  });

  it('blocks a denylisted counterparty', async () => {
    const oracle = new StaticSanctionOracle({ denied: ['account-bad'] });
    const screener = new OracleSanctionScreener(oracle);
    const result = await screener.screen(cp('account-bad'));
    expect(result.verdict).toBe('blocked');
  });

  it('picks up a list update after cache invalidation (drift)', async () => {
    const oracle = new StaticSanctionOracle();
    const screener = new OracleSanctionScreener(oracle, { cacheTtlMs: 60_000 });
    const target = cp('account-x');

    expect((await screener.screen(target)).verdict).toBe('clear');
    oracle.add('account-x'); // sanctioned mid-run
    screener.invalidate(target);
    expect((await screener.screen(target)).verdict).toBe('blocked');
  });

  it('fails closed when the oracle throws', async () => {
    const throwing = {
      id: 'broken',
      async check(): Promise<never> {
        throw new Error('oracle down');
      },
    };
    const screener = new OracleSanctionScreener(throwing, { onError: 'block' });
    expect((await screener.screen(cp('any'))).verdict).toBe('blocked');
  });
});
