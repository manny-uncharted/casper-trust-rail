/**
 * A {@link SanctionOracle} the agent screens counterparties against before it
 * pays a data provider or accepts a consumer — wrapped by the treasury kit's
 * {@link OracleSanctionScreener} for real-time, TTL-cached, fail-closed gating.
 *
 * {@link StaticSanctionOracle} is a seeded denylist for tests/demos.
 * {@link HttpSanctionOracle} calls a live vendor/indexer endpoint (Chainalysis,
 * TRM, OFAC mirror) and is the production path.
 */

import type { SanctionOracle, SanctionOracleResult } from './screener.js';

/** Denylist-backed oracle. Anything in the set is `blocked`. */
export class StaticSanctionOracle implements SanctionOracle {
  readonly id: string;
  private readonly denied: Set<string>;
  private readonly flagged: Set<string>;

  constructor(options: { id?: string; denied?: Iterable<string>; flagged?: Iterable<string> } = {}) {
    this.id = options.id ?? 'static-denylist';
    this.denied = new Set([...(options.denied ?? [])].map((a) => a.toLowerCase()));
    this.flagged = new Set([...(options.flagged ?? [])].map((a) => a.toLowerCase()));
  }

  async check(query: { id: string; address: string; chain: string }): Promise<SanctionOracleResult> {
    const addr = query.address.toLowerCase();
    if (this.denied.has(addr)) {
      return { listed: true, severity: 'blocked', source: this.id, reasons: ['address on denylist'] };
    }
    if (this.flagged.has(addr)) {
      return { listed: true, severity: 'flagged', source: this.id, reasons: ['address flagged for review'] };
    }
    return { listed: false, source: this.id };
  }

  /** Mutate the denylist at runtime (simulates a list-update webhook). */
  add(address: string, severity: 'blocked' | 'flagged' = 'blocked'): void {
    (severity === 'blocked' ? this.denied : this.flagged).add(address.toLowerCase());
  }
}

export interface HttpSanctionOracleOptions {
  readonly url: string;
  readonly id?: string;
  /** Maps the endpoint's body to a verdict. */
  readonly parse: (raw: unknown) => SanctionOracleResult;
  readonly fetchJson?: (url: string, query: { address: string; chain: string }) => Promise<unknown>;
}

/** Live oracle backed by an HTTP vendor/indexer endpoint. */
export class HttpSanctionOracle implements SanctionOracle {
  readonly id: string;
  private readonly url: string;
  private readonly parse: (raw: unknown) => SanctionOracleResult;
  private readonly fetchJson: (url: string, query: { address: string; chain: string }) => Promise<unknown>;

  constructor(options: HttpSanctionOracleOptions) {
    this.id = options.id ?? 'http-sanctions';
    this.url = options.url;
    this.parse = options.parse;
    this.fetchJson =
      options.fetchJson ??
      (async (url, query) => {
        const globalFetch = (globalThis as { fetch?: (u: string) => Promise<Response> }).fetch;
        if (!globalFetch) throw new Error('HttpSanctionOracle: no fetch available');
        const u = new URL(url);
        u.searchParams.set('address', query.address);
        u.searchParams.set('chain', query.chain);
        const res = await globalFetch(u.toString());
        if (!res.ok) throw new Error(`HttpSanctionOracle: ${res.status}`);
        return res.json();
      });
  }

  async check(query: { id: string; address: string; chain: string }): Promise<SanctionOracleResult> {
    const raw = await this.fetchJson(this.url, { address: query.address, chain: query.chain });
    return this.parse(raw);
  }
}
