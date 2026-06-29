/**
 * Off-chain RWA data sources for T-bill / treasury yields.
 *
 * A source yields a {@link TBillObservation}: a rate for a tenor, with
 * provenance and freshness. The default {@link StaticTBillDataSource} is for
 * tests/demos; {@link HttpTBillDataSource} fetches and parses a live endpoint
 * (optionally through x402 pay-per-request) and is the production path.
 */

/** Fixed-point scale used when posting a rate on-chain: percent × 1e6. */
export const RATE_SCALE = 1_000_000;

/** A single observed yield. */
export interface TBillObservation {
  /** Feed id used on-chain, e.g. `"us-3m-tbill"`. */
  readonly feedId: string;
  /** Human label, e.g. `"US 3-Month T-Bill"`. */
  readonly label: string;
  /** Annualised yield as a percent, e.g. `5.31`. */
  readonly ratePercent: number;
  /** ISO date the observation is for. */
  readonly asOf: string;
  /** Provenance string stored on-chain. */
  readonly source: string;
}

/** Scale a percent rate to the on-chain integer value (percent × 1e6). */
export function toOnChainValue(ratePercent: number): bigint {
  return BigInt(Math.round(ratePercent * RATE_SCALE));
}

/** A source of T-bill observations. */
export interface TBillDataSource {
  readonly id: string;
  fetch(feedId: string): Promise<TBillObservation>;
}

/** Deterministic in-memory source for tests and offline demos. */
export class StaticTBillDataSource implements TBillDataSource {
  readonly id = 'static';
  private readonly byFeed: Map<string, TBillObservation>;

  constructor(observations: readonly TBillObservation[]) {
    this.byFeed = new Map(observations.map((o) => [o.feedId, o]));
  }

  async fetch(feedId: string): Promise<TBillObservation> {
    const obs = this.byFeed.get(feedId);
    if (!obs) throw new Error(`StaticTBillDataSource: no observation for "${feedId}"`);
    return obs;
  }
}

/** Parses a raw HTTP body into an observation. */
export type TBillParser = (raw: unknown, feedId: string) => TBillObservation;

export interface HttpTBillDataSourceOptions {
  readonly url: string;
  readonly parser: TBillParser;
  /**
   * Fetcher for the body. Defaults to `fetch(url).json()`. Pass a function that
   * routes through `CasperX402Facilitator.payAndFetch` to pay per request.
   */
  readonly fetchJson?: (url: string) => Promise<unknown>;
  readonly id?: string;
}

/** Live source backed by an HTTP endpoint with a pluggable parser. */
export class HttpTBillDataSource implements TBillDataSource {
  readonly id: string;
  private readonly url: string;
  private readonly parser: TBillParser;
  private readonly fetchJson: (url: string) => Promise<unknown>;

  constructor(options: HttpTBillDataSourceOptions) {
    this.id = options.id ?? 'http';
    this.url = options.url;
    this.parser = options.parser;
    this.fetchJson =
      options.fetchJson ??
      (async (url) => {
        const globalFetch = (globalThis as { fetch?: (u: string) => Promise<Response> }).fetch;
        if (!globalFetch) throw new Error('HttpTBillDataSource: no fetch available');
        const res = await globalFetch(url);
        if (!res.ok) throw new Error(`HttpTBillDataSource: ${res.status} fetching ${url}`);
        return res.json();
      });
  }

  async fetch(feedId: string): Promise<TBillObservation> {
    const raw = await this.fetchJson(this.url);
    return this.parser(raw, feedId);
  }
}
