/**
 * Casper domain types used across the Trust Rail.
 *
 * These deliberately do not leak `casper-js-sdk` types: the SDK is an optional
 * peer dependency reached only through {@link RealCasperRpc}, so the rest of the
 * package (and its tests) stay dependency-free.
 */

/** CAIP-2 Casper network identifiers used by the x402 facilitator. */
export type CasperNetwork = 'casper' | 'casper-test';

/** CAIP-2 string for a Casper network. */
export function caip2(network: CasperNetwork): `casper:${CasperNetwork}` {
  return `casper:${network}`;
}

/** A typed argument passed to a Casper contract entry point. */
export type CasperArg =
  | { readonly clType: 'string'; readonly value: string }
  | { readonly clType: 'bool'; readonly value: boolean }
  | { readonly clType: 'u8' | 'u32' | 'u64'; readonly value: number | bigint }
  | { readonly clType: 'u256'; readonly value: bigint }
  | { readonly clType: 'key' | 'account_hash'; readonly value: string };

/** Named runtime args for an entry-point call. */
export type CasperArgs = Readonly<Record<string, CasperArg>>;

/** Parameters for invoking a stored-contract entry point. */
export interface CallEntryPointParams {
  /** `hash-...` of the stored contract. */
  readonly contractHash: string;
  /** Entry point to invoke, e.g. `"post_data_point"`. */
  readonly entryPoint: string;
  /** Named runtime arguments. */
  readonly args: CasperArgs;
  /** Motes to attach as payment for execution gas. */
  readonly paymentMotes: bigint;
}

/** Result of submitting a deploy/transaction. */
export interface DeployResult {
  readonly deployHash: string;
}

/** Terminal or in-flight status of a submitted deploy. */
export interface DeployStatus {
  readonly deployHash: string;
  readonly state: 'pending' | 'success' | 'failure';
  readonly blockHash?: string;
  readonly errorMessage?: string;
  /** Gas cost in motes, when executed. */
  readonly cost?: bigint;
}

/** Identifies a value to read out of a contract's named keys / a dictionary. */
export interface QueryParams {
  readonly contractHash: string;
  /** Named key under the contract, e.g. a dictionary name like `"feeds"`. */
  readonly dictionaryName?: string;
  /** Dictionary item key, e.g. the feed id. */
  readonly dictionaryItemKey?: string;
  /** Path segments for a plain named-key query. */
  readonly path?: readonly string[];
}

/**
 * Minimal transport the Trust Rail needs from a Casper node / CSPR.cloud.
 * Implemented by {@link MockCasperRpc} (tests) and {@link RealCasperRpc}
 * (`casper-js-sdk`).
 */
export interface CasperRpc {
  readonly network: CasperNetwork;
  callEntryPoint(params: CallEntryPointParams): Promise<DeployResult>;
  getDeploy(deployHash: string): Promise<DeployStatus>;
  queryState(params: QueryParams): Promise<unknown>;
  getBalanceMotes(account: string): Promise<bigint>;
}

/** Block explorer URL for a deploy on a given network. */
export function explorerDeployUrl(network: CasperNetwork, deployHash: string): string {
  const host = network === 'casper' ? 'cspr.live' : 'testnet.cspr.live';
  return `https://${host}/deploy/${deployHash}`;
}
