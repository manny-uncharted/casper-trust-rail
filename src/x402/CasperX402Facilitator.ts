/**
 * Client for the CSPR.cloud x402 Facilitator
 * (`https://x402-facilitator.cspr.cloud`).
 *
 * Wraps the three documented endpoints — `GET /supported`, `POST /verify`,
 * `POST /settle` — and provides {@link CasperX402Facilitator.payAndFetch}, the
 * full client flow: request a paid resource, get a `402` + `PaymentRequirements`,
 * sign an `exact`-scheme authorization, and retry with the payment header.
 *
 * Buildathon teams get sponsored facilitator usage; pass the issued access
 * token as `accessToken`.
 */

import type { ExactPaymentSigner } from './ExactPaymentSigner.js';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from './types.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CasperX402FacilitatorOptions {
  readonly baseUrl?: string;
  readonly accessToken?: string;
  /** Injectable fetch (defaults to global `fetch`). */
  readonly fetch?: FetchLike;
}

const DEFAULT_BASE_URL = 'https://x402-facilitator.cspr.cloud';

/** Base64-encode a payment payload for the `X-PAYMENT` request header. */
export function encodePaymentHeader(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export class CasperX402Facilitator {
  private readonly baseUrl: string;
  private readonly accessToken: string | undefined;
  private readonly fetchImpl: FetchLike;

  constructor(options: CasperX402FacilitatorOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.accessToken = options.accessToken;
    const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
    const resolved = options.fetch ?? globalFetch;
    if (!resolved) throw new Error('CasperX402Facilitator: no fetch implementation available');
    this.fetchImpl = resolved;
  }

  async supported(): Promise<SupportedResponse> {
    return this.request<SupportedResponse>('GET', '/supported');
  }

  async verify(
    requirements: PaymentRequirements,
    payment: PaymentPayload,
  ): Promise<VerifyResponse> {
    return this.request<VerifyResponse>('POST', '/verify', {
      paymentRequirements: requirements,
      paymentPayload: payment,
    });
  }

  async settle(
    requirements: PaymentRequirements,
    payment: PaymentPayload,
  ): Promise<SettleResponse> {
    return this.request<SettleResponse>('POST', '/settle', {
      paymentRequirements: requirements,
      paymentPayload: payment,
    });
  }

  /**
   * Fetch a paid resource end-to-end. On a `402`, parse the requirements, sign,
   * and retry with the `X-PAYMENT` header. Returns the unlocked response.
   */
  async payAndFetch(
    url: string,
    signer: ExactPaymentSigner,
    init: RequestInit = {},
  ): Promise<{ response: Response; paid: boolean; requirements?: PaymentRequirements }> {
    const first = await this.fetchImpl(url, init);
    if (first.status !== 402) {
      return { response: first, paid: false };
    }

    const requirements = await parseRequirements(first);
    const payment = await signer.authorize(requirements);
    const headers = new Headers(init.headers);
    headers.set('X-PAYMENT', encodePaymentHeader(payment));

    const response = await this.fetchImpl(url, { ...init, headers });
    return { response, paid: true, requirements };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`x402 facilitator ${method} ${path} failed: ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  }
}

async function parseRequirements(res: Response): Promise<PaymentRequirements> {
  const data = (await res.json()) as { accepts?: PaymentRequirements[] } | PaymentRequirements;
  if (data && typeof data === 'object' && 'accepts' in data && Array.isArray(data.accepts)) {
    const first = data.accepts[0];
    if (!first) throw new Error('x402: 402 response had an empty `accepts` array');
    return first;
  }
  return data as PaymentRequirements;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}
