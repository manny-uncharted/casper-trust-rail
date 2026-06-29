/**
 * In-memory {@link CasperRpc} for tests, demos, and local dry-runs.
 *
 * It records every entry-point call, settles deploys to `success` by default,
 * and lets callers seed query responses. This is what the agent runs against
 * when no funded Casper key is configured, so the full fetch → attest → screen
 * → post → settle loop is exercisable offline.
 */

import type {
  CallEntryPointParams,
  CasperNetwork,
  CasperRpc,
  DeployResult,
  DeployStatus,
  QueryParams,
} from './types.js';

let counter = 0;
function fakeDeployHash(): string {
  counter += 1;
  const n = counter.toString(16).padStart(8, '0');
  return `mock${n}${'0'.repeat(56)}`.slice(0, 64);
}

export interface MockCasperRpcOptions {
  readonly network?: CasperNetwork;
  /** Force submitted deploys to fail (for failure-path tests). */
  readonly failDeploys?: boolean;
  readonly startingBalanceMotes?: bigint;
}

export class MockCasperRpc implements CasperRpc {
  readonly network: CasperNetwork;
  readonly calls: CallEntryPointParams[] = [];
  private readonly deploys = new Map<string, DeployStatus>();
  private readonly queryResponses = new Map<string, unknown>();
  private readonly failDeploys: boolean;
  private balanceMotes: bigint;

  constructor(options: MockCasperRpcOptions = {}) {
    this.network = options.network ?? 'casper-test';
    this.failDeploys = options.failDeploys ?? false;
    this.balanceMotes = options.startingBalanceMotes ?? 1_000_000_000_000n;
  }

  async callEntryPoint(params: CallEntryPointParams): Promise<DeployResult> {
    this.calls.push(params);
    const deployHash = fakeDeployHash();
    const status: DeployStatus = this.failDeploys
      ? { deployHash, state: 'failure', errorMessage: 'mock: forced failure' }
      : { deployHash, state: 'success', blockHash: `block-${deployHash.slice(0, 8)}`, cost: params.paymentMotes };
    this.deploys.set(deployHash, status);
    return { deployHash };
  }

  async getDeploy(deployHash: string): Promise<DeployStatus> {
    return this.deploys.get(deployHash) ?? { deployHash, state: 'pending' };
  }

  async queryState(params: QueryParams): Promise<unknown> {
    const key = this.queryKey(params);
    if (!this.queryResponses.has(key)) {
      throw new Error(`MockCasperRpc: no seeded query response for "${key}"`);
    }
    return this.queryResponses.get(key);
  }

  async getBalanceMotes(_account: string): Promise<bigint> {
    return this.balanceMotes;
  }

  /** Seed a deterministic response for a future {@link queryState} call. */
  seedQuery(params: QueryParams, value: unknown): void {
    this.queryResponses.set(this.queryKey(params), value);
  }

  /** Count of entry-point calls matching a given entry point name. */
  callsTo(entryPoint: string): CallEntryPointParams[] {
    return this.calls.filter((c) => c.entryPoint === entryPoint);
  }

  private queryKey(params: QueryParams): string {
    return [
      params.contractHash,
      params.dictionaryName ?? '',
      params.dictionaryItemKey ?? '',
      (params.path ?? []).join('/'),
    ].join('::');
  }
}
