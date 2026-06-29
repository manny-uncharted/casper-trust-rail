/**
 * Types for Casper-native x402, modelled on the CSPR.cloud x402 Facilitator API
 * (`https://x402-facilitator.cspr.cloud`) and the `exact` payment scheme over
 * CEP-18 tokens, authorised by EIP-712 typed-data signatures.
 *
 * Field names follow the x402 standard (`PaymentRequirements`, `PaymentPayload`)
 * so the same shapes round-trip through the facilitator's `/verify` and
 * `/settle` endpoints.
 */

import type { CasperNetwork } from '../casper/types.js';

/** CAIP-2 network string accepted by the facilitator. */
export type X402Network = `casper:${CasperNetwork}`;

/** The `402 Payment Required` challenge a resource server returns. */
export interface PaymentRequirements {
  /** Payment scheme. Casper supports `"exact"`. */
  readonly scheme: 'exact';
  /** CAIP-2 network, e.g. `"casper:casper-test"`. */
  readonly network: X402Network;
  /** Amount required, as the smallest unit of `asset` (string for precision). */
  readonly maxAmountRequired: string;
  /** Where the resource lives (the paid endpoint). */
  readonly resource: string;
  /** Human description of what is being bought. */
  readonly description: string;
  /** MIME type of the response the payment unlocks. */
  readonly mimeType: string;
  /** Account hash / key that receives payment. */
  readonly payTo: string;
  /** CEP-18 token contract hash used for settlement. */
  readonly asset: string;
  /** Seconds the requirement/quote is valid for. */
  readonly maxTimeoutSeconds: number;
  /** Optional scheme-specific extra (e.g. token name/decimals for EIP-712 domain). */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** The signed authorization a client attaches to retry the request. */
export interface PaymentPayload {
  /** x402 envelope version. */
  readonly x402Version: number;
  readonly scheme: 'exact';
  readonly network: X402Network;
  /** Scheme payload: the signed transfer authorization. */
  readonly payload: ExactSchemePayload;
}

/** `exact` scheme payload: an EIP-712-signed CEP-18 transfer authorization. */
export interface ExactSchemePayload {
  /** Hex signature over the EIP-712 typed data. */
  readonly signature: string;
  /** The authorization that was signed. */
  readonly authorization: TransferAuthorization;
}

/** The CEP-18 transfer the payer authorizes (EIP-712 `TransferWithAuthorization`). */
export interface TransferAuthorization {
  readonly from: string;
  readonly to: string;
  /** Amount in the asset's smallest unit. */
  readonly value: string;
  /** Unix seconds; authorization invalid before this. */
  readonly validAfter: number;
  /** Unix seconds; authorization invalid after this. */
  readonly validBefore: number;
  /** 32-byte hex nonce, unique per authorization (replay protection). */
  readonly nonce: string;
}

/** `GET /supported` response. */
export interface SupportedResponse {
  readonly kinds: ReadonlyArray<{ scheme: string; network: string }>;
}

/** `POST /verify` response. */
export interface VerifyResponse {
  readonly isValid: boolean;
  readonly invalidReason?: string;
  readonly payer?: string;
}

/** `POST /settle` response. */
export interface SettleResponse {
  readonly success: boolean;
  /** On-chain deploy/transaction hash of the settlement. */
  readonly transaction?: string;
  readonly network?: X402Network;
  readonly payer?: string;
  readonly errorReason?: string;
}
