/**
 * Counterparty sanctions screening real-time, TTL-cached, fail-closed.
 *
 * Trust Rail screens the account it settles to (and, in production, data
 * providers it pays and consumers it serves) before every post. A naive static
 * denylist seeded at startup goes stale: a long-running agent that booted before
 * an address was sanctioned would keep transacting with it. {@link OracleSanctionScreener}
 * instead consults a live {@link SanctionOracle} before each check, with a short
 * TTL cache so the hot path stays fast while bounding how stale a verdict can be.
 *
 * Failure is **fail-closed** by default: if the oracle is unreachable the
 * counterparty is blocked, not waved through. Configurable for deployments that
 * prefer flag-and-continue.
 */

/** A party Trust Rail may move value to or accept value from. */
export interface Counterparty {
  /** Stable canonical id (e.g. `chain:address`). */
  id: string;
  /** Chain/network symbol, e.g. `"casper:casper-test"`. */
  chain: string;
  /** Account/address on that chain. */
  address: string;
  /** Optional human label for evidence. */
  label?: string;
}

export type SanctionVerdict = 'clear' | 'blocked' | 'flagged';

/** Outcome of screening one counterparty. */
export interface SanctionScreening {
  verdict: SanctionVerdict;
  reasons: string[];
  /** Screener/provider id, for the evidence trail. */
  provider: string;
  evaluatedAt: number;
}

/** Anything that can screen a counterparty. */
export interface SanctionScreener {
  readonly id: string;
  screen(counterparty: Counterparty): Promise<SanctionScreening>;
}

/** A live sanctions data source (vendor API or on/off-chain indexer). */
export interface SanctionOracleResult {
  /** Whether the counterparty currently appears on a sanctions/denylist. */
  listed: boolean;
  /** Severity when listed. `blocked` is a hard stop. Default `blocked`. */
  severity?: 'blocked' | 'flagged';
  /** Source list/provider, e.g. `"ofac-sdn"`. */
  source?: string;
  reasons?: string[];
  /** Oracle-reported list freshness, if available. */
  asOf?: number;
}

export interface SanctionOracle {
  readonly id: string;
  check(query: { id: string; address: string; chain: string }): Promise<SanctionOracleResult>;
}

export interface OracleSanctionScreenerOptions {
  /** How long (ms) a verdict may be reused before re-querying. Default 60_000. */
  cacheTtlMs?: number;
  /** On oracle error: `block` (default, fail-closed), `flag`, or `allow`. */
  onError?: 'block' | 'flag' | 'allow';
  now?: () => number;
}

interface CacheEntry {
  screening: SanctionScreening;
  cachedAt: number;
}

/** Always-clear screener (tests / explicit opt-out). */
export class NoopSanctionScreener implements SanctionScreener {
  readonly id = 'noop';
  async screen(_cp: Counterparty): Promise<SanctionScreening> {
    return { verdict: 'clear', reasons: [], provider: this.id, evaluatedAt: Date.now() };
  }
}

/** Real-time, TTL-cached, fail-closed screener over a {@link SanctionOracle}. */
export class OracleSanctionScreener implements SanctionScreener {
  readonly id: string;
  private readonly oracle: SanctionOracle;
  private readonly cacheTtlMs: number;
  private readonly onError: 'block' | 'flag' | 'allow';
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(oracle: SanctionOracle, options: OracleSanctionScreenerOptions = {}) {
    this.oracle = oracle;
    this.id = `oracle[${oracle.id}]`;
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.onError = options.onError ?? 'block';
    this.now = options.now ?? Date.now;
  }

  private key(cp: Counterparty): string {
    return `${cp.chain}:${cp.address.toLowerCase()}`;
  }

  async screen(cp: Counterparty): Promise<SanctionScreening> {
    const key = this.key(cp);
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.screening;
    }

    try {
      const result = await this.oracle.check({ id: cp.id, address: cp.address, chain: cp.chain });
      const screening = this.toScreening(result);
      // Only successful queries are cached; errors must re-query next time.
      this.cache.set(key, { screening, cachedAt: this.now() });
      return screening;
    } catch (err) {
      return this.onOracleError(cp, err);
    }
  }

  private toScreening(result: SanctionOracleResult): SanctionScreening {
    const provider = result.source ? `${this.id}:${result.source}` : this.id;
    if (!result.listed) {
      return { verdict: 'clear', reasons: result.reasons ?? [], provider, evaluatedAt: this.now() };
    }
    return {
      verdict: result.severity === 'flagged' ? 'flagged' : 'blocked',
      reasons:
        result.reasons && result.reasons.length > 0
          ? result.reasons
          : [`counterparty listed by ${provider}`],
      provider,
      evaluatedAt: this.now(),
    };
  }

  private onOracleError(cp: Counterparty, err: unknown): SanctionScreening {
    const message = err instanceof Error ? err.message : String(err);
    const reason = `sanctions oracle unavailable (${this.id}): ${message}`;
    if (this.onError === 'allow') {
      return { verdict: 'clear', reasons: [reason], provider: this.id, evaluatedAt: this.now() };
    }
    return {
      verdict: this.onError === 'flag' ? 'flagged' : 'blocked',
      reasons: [reason, `fail-closed (onError=${this.onError}) for ${cp.id}`],
      provider: this.id,
      evaluatedAt: this.now(),
    };
  }

  /** Drop a cached verdict (e.g. on a list-update webhook) so it re-queries. */
  invalidate(cp: Counterparty): void {
    this.cache.delete(this.key(cp));
  }

  /** Clear the whole cache — forces a fresh query for every counterparty. */
  clearCache(): void {
    this.cache.clear();
  }
}
