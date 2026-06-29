/**
 * Builds and signs `exact`-scheme x402 payment payloads for Casper.
 *
 * Casper's x402 ports EIP-712 typed-data signing, so the authorization is a
 * `TransferWithAuthorization` struct signed over an EIP-712 domain. The typed
 * data is built here (pure, testable) and signed through an injected
 * {@link PaymentSigner} — pass an `ethers` `Wallet` (`signTypedData`) for the
 * EIP-712 port, or a Casper-key signer. Nothing here imports a wallet library.
 */

import type {
  ExactSchemePayload,
  PaymentPayload,
  PaymentRequirements,
  TransferAuthorization,
  X402Network,
} from './types.js';

/** EIP-712 typed-data document. */
export interface TypedData {
  readonly domain: Readonly<Record<string, unknown>>;
  readonly types: Readonly<Record<string, ReadonlyArray<{ name: string; type: string }>>>;
  readonly primaryType: string;
  readonly message: Readonly<Record<string, unknown>>;
}

/** Anything that can produce an EIP-712 signature (e.g. an ethers Wallet). */
export interface PaymentSigner {
  /** The payer's address / account identifier. */
  readonly address: string;
  signTypedData(data: TypedData): Promise<string>;
}

export interface ExactPaymentSignerOptions {
  /** Override the random nonce (tests / determinism). */
  readonly nonce?: () => string;
  /** Override the clock (tests). */
  readonly now?: () => number;
}

const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'string' },
    { name: 'to', type: 'string' },
    { name: 'value', type: 'string' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/** Build the EIP-712 typed data for an `exact`-scheme transfer authorization. */
export function buildTransferTypedData(
  requirements: PaymentRequirements,
  authorization: TransferAuthorization,
): TypedData {
  const extra = requirements.extra ?? {};
  return {
    domain: {
      name: typeof extra.name === 'string' ? extra.name : 'CasperX402',
      version: typeof extra.version === 'string' ? extra.version : '1',
      // The CAIP-2 network and CEP-18 asset stand in for chainId/verifyingContract.
      network: requirements.network,
      verifyingContract: requirements.asset,
    },
    types: TRANSFER_TYPES as unknown as TypedData['types'],
    primaryType: 'TransferWithAuthorization',
    message: { ...authorization },
  };
}

function randomNonceHex(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export class ExactPaymentSigner {
  private readonly signer: PaymentSigner;
  private readonly nonce: () => string;
  private readonly now: () => number;

  constructor(signer: PaymentSigner, options: ExactPaymentSignerOptions = {}) {
    this.signer = signer;
    this.nonce = options.nonce ?? randomNonceHex;
    this.now = options.now ?? Date.now;
  }

  /**
   * Build a signed {@link PaymentPayload} satisfying a `402` challenge.
   * `value` defaults to the full `maxAmountRequired`.
   */
  async authorize(
    requirements: PaymentRequirements,
    options: { value?: string } = {},
  ): Promise<PaymentPayload> {
    const nowSec = Math.floor(this.now() / 1000);
    const authorization: TransferAuthorization = {
      from: this.signer.address,
      to: requirements.payTo,
      value: options.value ?? requirements.maxAmountRequired,
      validAfter: nowSec - 5,
      validBefore: nowSec + requirements.maxTimeoutSeconds,
      nonce: this.nonce(),
    };

    const typedData = buildTransferTypedData(requirements, authorization);
    const signature = await this.signer.signTypedData(typedData);

    const payload: ExactSchemePayload = { signature, authorization };
    return {
      x402Version: 1,
      scheme: 'exact',
      network: requirements.network as X402Network,
      payload,
    };
  }
}
