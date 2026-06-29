/**
 * High-level Casper client for the Trust Rail contracts.
 *
 * Wraps a {@link CasperRpc} transport and exposes the three contracts'
 * operations as typed methods, so the agent never hand-builds runtime args or
 * polls deploys itself.
 */

import type {
  CasperArgs,
  CasperRpc,
  DeployResult,
  DeployStatus,
  QueryParams,
} from './types.js';
import { explorerDeployUrl } from './types.js';

/** Deployed contract hashes for one Trust Rail environment. */
export interface TrustRailContracts {
  readonly identity: string;
  readonly reputation: string;
  readonly oracle: string;
}

export interface CasperClientOptions {
  /** Default gas (motes) attached to a mutating call. Default: 5 CSPR. */
  readonly defaultPaymentMotes?: bigint;
  /** Poll interval while confirming a deploy. Default: 2000ms. */
  readonly pollIntervalMs?: number;
  /** Max polls before giving up. Default: 60 (~2min at 2s). */
  readonly maxPolls?: number;
  /** Injectable sleep for deterministic tests. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** A data point as read back from the oracle contract. */
export interface OracleFeedPoint {
  readonly value: bigint;
  readonly source: string;
  readonly attestationHash: string;
  readonly agentId: string;
  readonly timestamp: bigint;
  readonly sequence: bigint;
}

const DEFAULT_PAYMENT = 5_000_000_000n; // 5 CSPR
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class CasperClient {
  private readonly rpc: CasperRpc;
  private readonly contracts: TrustRailContracts;
  private readonly payment: bigint;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(rpc: CasperRpc, contracts: TrustRailContracts, options: CasperClientOptions = {}) {
    this.rpc = rpc;
    this.contracts = contracts;
    this.payment = options.defaultPaymentMotes ?? DEFAULT_PAYMENT;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.maxPolls = options.maxPolls ?? 60;
    this.sleep = options.sleep ?? defaultSleep;
  }

  // ---- identity ---------------------------------------------------------

  registerAgent(agentId: string, metadata: string): Promise<DeployResult> {
    return this.rpc.callEntryPoint({
      contractHash: this.contracts.identity,
      entryPoint: 'register',
      paymentMotes: this.payment,
      args: {
        agent_id: { clType: 'string', value: agentId },
        metadata: { clType: 'string', value: metadata },
      },
    });
  }

  // ---- reputation -------------------------------------------------------

  recordOutcome(agentId: string, accurate: boolean): Promise<DeployResult> {
    return this.rpc.callEntryPoint({
      contractHash: this.contracts.reputation,
      entryPoint: 'record_outcome',
      paymentMotes: this.payment,
      args: {
        agent_id: { clType: 'string', value: agentId },
        accurate: { clType: 'bool', value: accurate },
      },
    });
  }

  async scoreOf(agentId: string): Promise<number> {
    const raw = await this.rpc.queryState({
      contractHash: this.contracts.reputation,
      dictionaryName: 'reputation_score',
      dictionaryItemKey: agentId,
    });
    return Number(raw ?? 5000);
  }

  // ---- oracle -----------------------------------------------------------

  postDataPoint(input: {
    feedId: string;
    value: bigint;
    source: string;
    attestationHash: string;
    agentId: string;
  }): Promise<DeployResult> {
    const args: CasperArgs = {
      feed_id: { clType: 'string', value: input.feedId },
      value: { clType: 'u64', value: input.value },
      source: { clType: 'string', value: input.source },
      attestation_hash: { clType: 'string', value: input.attestationHash },
      agent_id: { clType: 'string', value: input.agentId },
    };
    return this.rpc.callEntryPoint({
      contractHash: this.contracts.oracle,
      entryPoint: 'post_data_point',
      paymentMotes: this.payment,
      args,
    });
  }

  consume(feedId: string): Promise<DeployResult> {
    return this.rpc.callEntryPoint({
      contractHash: this.contracts.oracle,
      entryPoint: 'consume',
      paymentMotes: this.payment,
      args: { feed_id: { clType: 'string', value: feedId } },
    });
  }

  async latest(feedId: string): Promise<OracleFeedPoint | null> {
    const raw = await this.rpc.queryState({
      contractHash: this.contracts.oracle,
      dictionaryName: 'feeds',
      dictionaryItemKey: feedId,
    });
    if (raw === null || raw === undefined) return null;
    return normalizeFeedPoint(raw);
  }

  // ---- deploy lifecycle -------------------------------------------------

  /** Submit a deploy and poll until it terminates. Throws on failure. */
  async confirm(result: DeployResult): Promise<DeployStatus> {
    for (let i = 0; i < this.maxPolls; i += 1) {
      const status = await this.rpc.getDeploy(result.deployHash);
      if (status.state === 'success') return status;
      if (status.state === 'failure') {
        throw new Error(
          `deploy ${result.deployHash} failed: ${status.errorMessage ?? 'unknown error'}`,
        );
      }
      await this.sleep(this.pollIntervalMs);
    }
    throw new Error(`deploy ${result.deployHash} did not confirm within ${this.maxPolls} polls`);
  }

  explorerUrl(deployHash: string): string {
    return explorerDeployUrl(this.rpc.network, deployHash);
  }

  /** The deployed RWA oracle contract hash (used in attestation intents). */
  oracleContractHash(): string {
    return this.contracts.oracle;
  }

  query(params: QueryParams): Promise<unknown> {
    return this.rpc.queryState(params);
  }
}

/** Coerce a loosely-typed query result into an {@link OracleFeedPoint}. */
function normalizeFeedPoint(raw: unknown): OracleFeedPoint {
  const r = raw as Record<string, unknown>;
  const toBig = (v: unknown): bigint => {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(Math.trunc(v));
    if (typeof v === 'string' && v.length > 0) return BigInt(v);
    return 0n;
  };
  const toStr = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));
  return {
    value: toBig(r.value),
    source: toStr(r.source),
    attestationHash: toStr(r.attestation_hash ?? r.attestationHash),
    agentId: toStr(r.agent_id ?? r.agentId),
    timestamp: toBig(r.timestamp),
    sequence: toBig(r.sequence),
  };
}
