/**
 * Live {@link CasperRpc} backed by `casper-js-sdk` and a CSPR.cloud / node RPC.
 *
 * `casper-js-sdk` is an **optional peer dependency**: it is imported lazily so
 * the rest of the package (and the whole test suite) compiles and runs without
 * it. Install it only when you want to hit a real network:
 *
 * ```bash
 * bun add casper-js-sdk
 * ```
 *
 * The SDK surface is reached through a small local {@link CasperSdkFacade}
 * interface and one boundary cast, so this file type-checks even when the
 * package is absent. The facade targets casper-js-sdk v5; if your installed
 * version differs, this adapter is the single place to reconcile it.
 */

import type {
  CallEntryPointParams,
  CasperArg,
  CasperNetwork,
  CasperRpc,
  DeployResult,
  DeployStatus,
  QueryParams,
} from './types.js';

/** A signing keypair as produced by the SDK. */
export interface CasperSigner {
  /** PEM contents of the secret key, or a pre-built SDK keypair. */
  readonly secretKeyPem?: string;
  readonly keypair?: unknown;
}

export interface RealCasperRpcOptions {
  /** Node JSON-RPC endpoint, e.g. CSPR.cloud `https://node.testnet.cspr.cloud/rpc`. */
  readonly nodeUrl: string;
  readonly network: CasperNetwork;
  /** Casper chain name for the deploy header, e.g. `"casper-test"`. */
  readonly chainName: string;
  /** Signing key used to author deploys. */
  readonly signer: CasperSigner;
  /** Optional CSPR.cloud access token, sent as a bearer header. */
  readonly accessToken?: string;
}

/** The slice of `casper-js-sdk` this adapter uses. */
interface CasperSdkFacade {
  buildAndPutDeploy(args: {
    nodeUrl: string;
    chainName: string;
    contractHash: string;
    entryPoint: string;
    runtimeArgs: ReadonlyArray<{ name: string; arg: CasperArg }>;
    paymentMotes: bigint;
    signer: CasperSigner;
    accessToken?: string;
  }): Promise<string>;
  getDeploy(args: { nodeUrl: string; deployHash: string; accessToken?: string }): Promise<DeployStatus>;
  queryDictionary(args: {
    nodeUrl: string;
    contractHash: string;
    dictionaryName: string;
    dictionaryItemKey: string;
    accessToken?: string;
  }): Promise<unknown>;
  queryNamedKey(args: {
    nodeUrl: string;
    contractHash: string;
    path: readonly string[];
    accessToken?: string;
  }): Promise<unknown>;
  getBalanceMotes(args: { nodeUrl: string; account: string; accessToken?: string }): Promise<bigint>;
}

export class RealCasperRpc implements CasperRpc {
  readonly network: CasperNetwork;
  private readonly opts: RealCasperRpcOptions;
  private facadePromise?: Promise<CasperSdkFacade>;

  constructor(options: RealCasperRpcOptions) {
    this.opts = options;
    this.network = options.network;
  }

  async callEntryPoint(params: CallEntryPointParams): Promise<DeployResult> {
    const sdk = await this.facade();
    const runtimeArgs = Object.entries(params.args).map(([name, arg]) => ({ name, arg }));
    const deployHash = await sdk.buildAndPutDeploy({
      nodeUrl: this.opts.nodeUrl,
      chainName: this.opts.chainName,
      contractHash: params.contractHash,
      entryPoint: params.entryPoint,
      runtimeArgs,
      paymentMotes: params.paymentMotes,
      signer: this.opts.signer,
      ...(this.opts.accessToken ? { accessToken: this.opts.accessToken } : {}),
    });
    return { deployHash };
  }

  async getDeploy(deployHash: string): Promise<DeployStatus> {
    const sdk = await this.facade();
    return sdk.getDeploy({
      nodeUrl: this.opts.nodeUrl,
      deployHash,
      ...(this.opts.accessToken ? { accessToken: this.opts.accessToken } : {}),
    });
  }

  async queryState(params: QueryParams): Promise<unknown> {
    const sdk = await this.facade();
    if (params.dictionaryName && params.dictionaryItemKey) {
      return sdk.queryDictionary({
        nodeUrl: this.opts.nodeUrl,
        contractHash: params.contractHash,
        dictionaryName: params.dictionaryName,
        dictionaryItemKey: params.dictionaryItemKey,
        ...(this.opts.accessToken ? { accessToken: this.opts.accessToken } : {}),
      });
    }
    return sdk.queryNamedKey({
      nodeUrl: this.opts.nodeUrl,
      contractHash: params.contractHash,
      path: params.path ?? [],
      ...(this.opts.accessToken ? { accessToken: this.opts.accessToken } : {}),
    });
  }

  async getBalanceMotes(account: string): Promise<bigint> {
    const sdk = await this.facade();
    return sdk.getBalanceMotes({
      nodeUrl: this.opts.nodeUrl,
      account,
      ...(this.opts.accessToken ? { accessToken: this.opts.accessToken } : {}),
    });
  }

  private facade(): Promise<CasperSdkFacade> {
    if (!this.facadePromise) {
      this.facadePromise = loadFacade();
    }
    return this.facadePromise;
  }
}

/**
 * Lazily import `casper-js-sdk` and adapt it to {@link CasperSdkFacade}.
 *
 * The adapter is loaded from a sibling module so a missing optional dependency
 * surfaces a single, actionable error rather than a hard import failure.
 */
async function loadFacade(): Promise<CasperSdkFacade> {
  try {
    const mod = (await import('./casperSdkFacade.js')) as { createFacade(): Promise<CasperSdkFacade> };
    return await mod.createFacade();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      'RealCasperRpc requires the optional peer dependency "casper-js-sdk". ' +
        `Install it with \`bun add casper-js-sdk\`. Underlying error: ${message}`,
    );
  }
}
