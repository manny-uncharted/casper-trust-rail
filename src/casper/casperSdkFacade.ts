/**
 * The single point of contact with `casper-js-sdk`.
 *
 * Everything SDK-specific lives here. The SDK is reached through a locally
 * declared {@link ClassicSdk} interface and one boundary cast, so this file
 * type-checks even when `casper-js-sdk` is not installed. It is coded against
 * the stable classic API (`CasperClient`, `Contracts.Contract`, `RuntimeArgs`,
 * `CLValueBuilder`, `CasperServiceByJsonRPC`, `Keys`), which the
 * `make-software/casper-x402` JS examples and `casper-contracts-js-clients`
 * also use. If you run a different major, reconcile it *here* — nothing else in
 * the package imports the SDK.
 */

import type { CasperArg, DeployStatus } from './types.js';

/** Minimal view of the SDK classes used below. */
interface ClassicSdk {
  CasperClient: new (nodeUrl: string) => {
    putDeploy(deploy: unknown): Promise<string>;
  };
  Contracts: {
    Contract: new (client?: unknown) => {
      setContractHash(hash: string): void;
      callEntrypoint(
        entryPoint: string,
        runtimeArgs: unknown,
        sender: unknown,
        chainName: string,
        paymentAmount: string,
        signingKeys?: unknown[],
      ): unknown;
    };
  };
  RuntimeArgs: { fromMap(map: Record<string, unknown>): unknown };
  CLValueBuilder: {
    string(v: string): unknown;
    bool(v: boolean): unknown;
    u8(v: number | bigint): unknown;
    u32(v: number | bigint): unknown;
    u64(v: number | bigint): unknown;
    u256(v: bigint): unknown;
    key(v: unknown): unknown;
    byteArray(v: Uint8Array): unknown;
  };
  CLPublicKey: { fromHex(hex: string): unknown };
  CasperServiceByJsonRPC: new (url: string) => {
    getStateRootHash(): Promise<string>;
    getDictionaryItemByName(
      stateRootHash: string,
      contractHash: string,
      dictionaryName: string,
      key: string,
    ): Promise<unknown>;
    getDeployInfo(deployHash: string): Promise<unknown>;
  };
  Keys: {
    Ed25519: {
      loadKeyPairFromPrivateFile?(path: string): unknown;
      parsePrivateKey?(pem: string): unknown;
    };
  };
}

/** What {@link RealCasperRpc} expects back. */
export interface CasperSdkFacade {
  buildAndPutDeploy(args: {
    nodeUrl: string;
    chainName: string;
    contractHash: string;
    entryPoint: string;
    runtimeArgs: ReadonlyArray<{ name: string; arg: CasperArg }>;
    paymentMotes: bigint;
    signer: { secretKeyPem?: string; keypair?: unknown };
    accessToken?: string;
  }): Promise<string>;
  getDeploy(args: { nodeUrl: string; deployHash: string }): Promise<DeployStatus>;
  queryDictionary(args: {
    nodeUrl: string;
    contractHash: string;
    dictionaryName: string;
    dictionaryItemKey: string;
  }): Promise<unknown>;
  queryNamedKey(args: { nodeUrl: string; contractHash: string; path: readonly string[] }): Promise<unknown>;
  getBalanceMotes(args: { nodeUrl: string; account: string }): Promise<bigint>;
}

export async function createFacade(): Promise<CasperSdkFacade> {
  const sdk = (await import('casper-js-sdk')) as unknown as ClassicSdk;

  const toCLValue = (arg: CasperArg): unknown => {
    switch (arg.clType) {
      case 'string':
        return sdk.CLValueBuilder.string(arg.value);
      case 'bool':
        return sdk.CLValueBuilder.bool(arg.value);
      case 'u8':
        return sdk.CLValueBuilder.u8(arg.value);
      case 'u32':
        return sdk.CLValueBuilder.u32(arg.value);
      case 'u64':
        return sdk.CLValueBuilder.u64(arg.value);
      case 'u256':
        return sdk.CLValueBuilder.u256(arg.value);
      case 'key':
      case 'account_hash':
        return sdk.CLValueBuilder.key(sdk.CLPublicKey.fromHex(arg.value));
    }
  };

  const loadKeypair = (signer: { secretKeyPem?: string; keypair?: unknown }): unknown => {
    if (signer.keypair) return signer.keypair;
    if (signer.secretKeyPem && sdk.Keys.Ed25519.parsePrivateKey) {
      return sdk.Keys.Ed25519.parsePrivateKey(signer.secretKeyPem);
    }
    throw new Error('RealCasperRpc: signer must provide a keypair or secretKeyPem');
  };

  return {
    async buildAndPutDeploy(args) {
      const client = new sdk.CasperClient(args.nodeUrl);
      const keypair = loadKeypair(args.signer) as { publicKey: unknown };
      const contract = new sdk.Contracts.Contract(client);
      contract.setContractHash(args.contractHash);

      const argMap: Record<string, unknown> = {};
      for (const { name, arg } of args.runtimeArgs) {
        argMap[name] = toCLValue(arg);
      }
      const runtimeArgs = sdk.RuntimeArgs.fromMap(argMap);

      const deploy = contract.callEntrypoint(
        args.entryPoint,
        runtimeArgs,
        keypair.publicKey,
        args.chainName,
        args.paymentMotes.toString(),
        [keypair],
      );
      return client.putDeploy(deploy);
    },

    async getDeploy(args) {
      const svc = new sdk.CasperServiceByJsonRPC(args.nodeUrl);
      const info = (await svc.getDeployInfo(args.deployHash)) as {
        execution_results?: Array<{ result?: { Success?: { cost?: string }; Failure?: { error_message?: string } } }>;
      };
      const exec = info.execution_results?.[0]?.result;
      if (exec?.Success) {
        return {
          deployHash: args.deployHash,
          state: 'success',
          cost: exec.Success.cost ? BigInt(exec.Success.cost) : 0n,
        };
      }
      if (exec?.Failure) {
        return {
          deployHash: args.deployHash,
          state: 'failure',
          errorMessage: exec.Failure.error_message ?? 'execution failed',
        };
      }
      return { deployHash: args.deployHash, state: 'pending' };
    },

    async queryDictionary(args) {
      const svc = new sdk.CasperServiceByJsonRPC(args.nodeUrl);
      const stateRootHash = await svc.getStateRootHash();
      const item = await svc.getDictionaryItemByName(
        stateRootHash,
        args.contractHash,
        args.dictionaryName,
        args.dictionaryItemKey,
      );
      return extractStoredValue(item);
    },

    async queryNamedKey(args) {
      const svc = new sdk.CasperServiceByJsonRPC(args.nodeUrl);
      const stateRootHash = await svc.getStateRootHash();
      const item = await svc.getDictionaryItemByName(
        stateRootHash,
        args.contractHash,
        args.path[0] ?? '',
        args.path.slice(1).join('/'),
      );
      return extractStoredValue(item);
    },

    async getBalanceMotes() {
      // Balance reads require resolving the account's main purse uref against the
      // latest state root. CSPR.cloud's REST `/accounts/{key}` endpoint is the
      // simpler path in production; wire it here for your deployment.
      throw new Error('getBalanceMotes: implement via CSPR.cloud REST for your deployment');
    },
  };
}

/** Pull the decoded value out of an SDK `StoredValue` envelope. */
function extractStoredValue(item: unknown): unknown {
  const node = item as { CLValue?: { parsed?: unknown }; parsed?: unknown } | null;
  if (node && typeof node === 'object') {
    if (node.CLValue && 'parsed' in node.CLValue) return node.CLValue.parsed;
    if ('parsed' in node) return node.parsed;
  }
  return item;
}
