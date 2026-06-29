import { describe, expect, it, vi } from 'vitest';
import {
  ExactPaymentSigner,
  buildTransferTypedData,
  type PaymentSigner,
} from '../src/x402/ExactPaymentSigner.js';
import {
  CasperX402Facilitator,
  encodePaymentHeader,
} from '../src/x402/CasperX402Facilitator.js';
import type { PaymentPayload, PaymentRequirements } from '../src/x402/types.js';

const requirements: PaymentRequirements = {
  scheme: 'exact',
  network: 'casper:casper-test',
  maxAmountRequired: '1000',
  resource: 'https://api.example.com/tbill',
  description: 'One T-bill yield read',
  mimeType: 'application/json',
  payTo: 'account-hash-aaaa',
  asset: 'hash-cep18usdc',
  maxTimeoutSeconds: 120,
  extra: { name: 'CasperX402', version: '1' },
};

class FixedSigner implements PaymentSigner {
  readonly address = 'account-hash-payer';
  readonly seen: unknown[] = [];
  async signTypedData(data: unknown): Promise<string> {
    this.seen.push(data);
    return '0xsignature';
  }
}

describe('ExactPaymentSigner', () => {
  it('builds deterministic EIP-712 typed data', () => {
    const td = buildTransferTypedData(requirements, {
      from: 'a',
      to: 'b',
      value: '1000',
      validAfter: 1,
      validBefore: 2,
      nonce: '0xdead',
    });
    expect(td.primaryType).toBe('TransferWithAuthorization');
    expect(td.domain.network).toBe('casper:casper-test');
    expect(td.domain.verifyingContract).toBe('hash-cep18usdc');
    expect(td.types.TransferWithAuthorization?.length).toBe(6);
  });

  it('authorizes a payment payload bound to the requirements', async () => {
    const signer = new ExactPaymentSigner(new FixedSigner(), {
      now: () => 1_700_000_000_000,
      nonce: () => '0xnonce',
    });
    const payload = await signer.authorize(requirements);
    expect(payload.scheme).toBe('exact');
    expect(payload.network).toBe('casper:casper-test');
    expect(payload.payload.signature).toBe('0xsignature');
    expect(payload.payload.authorization.to).toBe('account-hash-aaaa');
    expect(payload.payload.authorization.value).toBe('1000');
    expect(payload.payload.authorization.nonce).toBe('0xnonce');
    expect(payload.payload.authorization.validBefore).toBe(1_700_000_000 + 120);
  });
});

describe('CasperX402Facilitator', () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('verifies a payment via /verify', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/verify');
      return jsonResponse({ isValid: true, payer: 'account-hash-payer' });
    });
    const fac = new CasperX402Facilitator({ fetch: fetchMock, accessToken: 'tok' });
    const payload = { x402Version: 1, scheme: 'exact' } as unknown as PaymentPayload;
    const res = await fac.verify(requirements, payload);
    expect(res.isValid).toBe(true);
    // Authorization header carried the access token.
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('settles a payment via /settle and returns a tx hash', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, transaction: 'deploy-abc', network: 'casper:casper-test' }),
    );
    const fac = new CasperX402Facilitator({ fetch: fetchMock });
    const res = await fac.settle(requirements, {} as PaymentPayload);
    expect(res.success).toBe(true);
    expect(res.transaction).toBe('deploy-abc');
  });

  it('payAndFetch signs and retries on a 402 challenge', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      if (calls.length === 1) {
        return jsonResponse({ accepts: [requirements] }, 402);
      }
      return jsonResponse({ rate: 5.31 });
    });
    const fac = new CasperX402Facilitator({ fetch: fetchMock });
    const signer = new ExactPaymentSigner(new FixedSigner(), {
      now: () => 1_700_000_000_000,
      nonce: () => '0xnonce',
    });

    const { response, paid, requirements: req } = await fac.payAndFetch(
      'https://api.example.com/tbill',
      signer,
    );
    expect(paid).toBe(true);
    expect(req?.payTo).toBe('account-hash-aaaa');
    expect(await response.json()).toEqual({ rate: 5.31 });

    // Retry carried the X-PAYMENT header.
    const retryInit = calls[1]?.init;
    const headers = new Headers(retryInit?.headers);
    expect(headers.get('X-PAYMENT')).toBeTruthy();
  });

  it('encodePaymentHeader round-trips through base64 JSON', () => {
    const payload = {
      x402Version: 1,
      scheme: 'exact',
      network: 'casper:casper-test',
      payload: { signature: '0x', authorization: {} },
    } as unknown as PaymentPayload;
    const header = encodePaymentHeader(payload);
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    expect(decoded.scheme).toBe('exact');
  });
});
