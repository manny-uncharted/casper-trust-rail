/**
 * Post attestation — a signed, bound "allow" verdict that authorizes one exact
 * on-chain oracle write.
 *
 * The threat it closes: when the risk/policy logic and the signing key run in the
 * same process, a compromised host could flip an in-memory verdict and force a
 * post. The defence is to make the on-chain writer require a *cryptographically
 * signed verdict bound to the exact data point it is about to publish* — so a
 * verdict cannot be forged, nor replayed onto a different value. The bound hash
 * is what Trust Rail stores on-chain as a data point's `attestation_hash`, so a
 * consumer can match an on-chain number to the signed verdict that produced it.
 *
 * Enforcement is configurable: `enforce` (default for Trust Rail) refuses to post
 * without a valid bound `allow`; `warn` logs and proceeds. An explicit `deny`
 * always blocks, in either mode.
 */

const encoder = new TextEncoder();

/** Deterministic, sorted-key JSON so hashes/signatures are stable. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === 'bigint') return val.toString();
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex digest of a string. */
export async function sha256Hex(input: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest('SHA-256', encoder.encode(input)));
}

/** The exact on-chain write a verdict authorizes. Hashing it binds the two. */
export interface PostIntent {
  /** Network identifier, e.g. `"casper:casper-test"`. */
  chain: string;
  /** Oracle contract the value is written to. */
  oracle: string;
  /** Feed id, e.g. `"us-3m-tbill"`. */
  feedId: string;
  /** On-chain integer value (e.g. percent × 1e6). */
  value: string;
  /** Uniqueness salt to prevent verdict replay across identical values. */
  nonce?: string | number;
}

/** Deterministic hash binding an attestation to one specific post. */
export function computePostIntentHash(intent: PostIntent): Promise<string> {
  return sha256Hex(canonicalJson(intent));
}

export type AttestationVerdict = 'allow' | 'deny';

/** A signed verdict authorizing (or denying) one post. */
export interface PostAttestation {
  /** Hash of the {@link PostIntent} this verdict is bound to. */
  intentHash: string;
  verdict: AttestationVerdict;
  /** 0..1 risk the assessor assigned, for evidence. */
  riskScore?: number;
  /** Policy pack id + version. */
  policyId?: string;
  issuedAt: number;
  expiresAt?: number;
  /** Detached signature over the canonical attestation (minus signature). */
  signature?: string;
  verificationMethod?: string;
}

export interface AttestationSigner {
  readonly verificationMethod: string;
  sign(payload: string): Promise<string>;
}

export interface AttestationVerifier {
  verify(payload: string, signature: string, verificationMethod: string): Promise<boolean>;
}

/** Canonical bytes a signature is computed over (everything but the signature). */
export function canonicalAttestationPayload(att: PostAttestation): string {
  const { signature: _omit, ...rest } = att;
  return canonicalJson(rest);
}

/** Attach a signature + verification method to an attestation. */
export async function signPostAttestation(
  att: PostAttestation,
  signer: AttestationSigner,
): Promise<PostAttestation> {
  const signed: PostAttestation = { ...att, verificationMethod: signer.verificationMethod };
  signed.signature = await signer.sign(canonicalAttestationPayload(signed));
  return signed;
}

export type AttestationMode = 'enforce' | 'warn';

export interface PostAttestationGuardOptions {
  verifier: AttestationVerifier;
  /** `enforce` (default): no valid bound allow ⇒ no post. `warn`: log and proceed. */
  mode?: AttestationMode;
  now?: () => number;
  onWarn?: (message: string, intentHash: string) => void;
}

export interface AttestationDecision {
  /** Whether the post may proceed. */
  allowed: boolean;
  /** Whether a valid, bound, unexpired `allow` was verified. */
  verified: boolean;
  /** Why the post was blocked (enforce mode, or a `deny`). */
  reasons: string[];
  /** Non-fatal issues surfaced in warn mode. */
  warnings: string[];
}

/**
 * Consulted immediately before the on-chain write. Verifies the attestation is
 * present, signed, unexpired, an `allow`, and bound to the exact value.
 */
export class PostAttestationGuard {
  private readonly verifier: AttestationVerifier;
  private readonly mode: AttestationMode;
  private readonly now: () => number;
  private readonly onWarn: (message: string, intentHash: string) => void;

  constructor(options: PostAttestationGuardOptions) {
    this.verifier = options.verifier;
    this.mode = options.mode ?? 'enforce';
    this.now = options.now ?? Date.now;
    this.onWarn =
      options.onWarn ?? ((message) => console.warn(`[PostAttestationGuard] ${message}`));
  }

  async authorize(params: {
    intentHash: string;
    attestation?: PostAttestation;
  }): Promise<AttestationDecision> {
    const reasons: string[] = [];
    const { intentHash, attestation } = params;
    let hardDeny = false;

    if (!attestation) {
      reasons.push('no post attestation supplied');
    } else {
      if (attestation.verdict === 'deny') {
        hardDeny = true;
        reasons.push(
          `attestation verdict is "deny"${attestation.policyId ? ` (${attestation.policyId})` : ''}`,
        );
      }
      if (attestation.intentHash !== intentHash) {
        reasons.push('attestation is not bound to this post (intent hash mismatch)');
      }
      if (attestation.expiresAt !== undefined && this.now() > attestation.expiresAt) {
        reasons.push('attestation has expired');
      }
      if (!attestation.signature || !attestation.verificationMethod) {
        reasons.push('attestation is unsigned');
      } else {
        const ok = await this.verifier.verify(
          canonicalAttestationPayload(attestation),
          attestation.signature,
          attestation.verificationMethod,
        );
        if (!ok) reasons.push('attestation signature is invalid');
      }
    }

    if (reasons.length === 0) {
      return { allowed: true, verified: true, reasons: [], warnings: [] };
    }
    if (hardDeny || this.mode === 'enforce') {
      return { allowed: false, verified: false, reasons, warnings: [] };
    }
    const warnings: string[] = [];
    for (const r of reasons) {
      warnings.push(r);
      this.onWarn(`${r} — posting anyway (mode=warn)`, intentHash);
    }
    return { allowed: true, verified: false, reasons: [], warnings };
  }
}
