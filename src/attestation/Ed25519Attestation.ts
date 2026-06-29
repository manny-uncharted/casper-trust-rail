/**
 * Ed25519 signer/verifier pair for the reused `PolicyAttestation` primitive
 * from `the post-attestation module`.
 *
 * Casper accounts are ed25519 (or secp256k1); using ed25519 here keeps the
 * attestation key scheme aligned with the chain. Built on `node:crypto`, so no
 * extra dependency. The signer produces the detached signature bound to a data
 * point's intent hash; the verifier checks it at post time via
 * {@link PaymentAttestationGuard}.
 */

import {
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  createPublicKey,
  type KeyObject,
} from 'node:crypto';
import type { AttestationSigner, AttestationVerifier } from './postAttestation.js';

const PREFIX = 'ed25519:';
const encoder = new TextEncoder();

function publicKeyToVerificationMethod(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return `${PREFIX}${der.toString('base64')}`;
}

function verificationMethodToPublicKey(method: string): KeyObject {
  if (!method.startsWith(PREFIX)) {
    throw new Error(`unsupported verification method: ${method}`);
  }
  const der = Buffer.from(method.slice(PREFIX.length), 'base64');
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

/** A verifier usable on its own (e.g. inside `PaymentAttestationGuard`). */
export class Ed25519AttestationVerifier implements AttestationVerifier {
  async verify(payload: string, signature: string, verificationMethod: string): Promise<boolean> {
    try {
      const publicKey = verificationMethodToPublicKey(verificationMethod);
      return nodeVerify(null, encoder.encode(payload), publicKey, Buffer.from(signature, 'hex'));
    } catch {
      return false;
    }
  }
}

/** A signer + its matching verification method. */
export class Ed25519AttestationSigner implements AttestationSigner {
  readonly verificationMethod: string;
  private readonly privateKey: KeyObject;

  constructor(privateKey: KeyObject, publicKey: KeyObject) {
    this.privateKey = privateKey;
    this.verificationMethod = publicKeyToVerificationMethod(publicKey);
  }

  async sign(payload: string): Promise<string> {
    const sig = nodeSign(null, encoder.encode(payload), this.privateKey);
    return sig.toString('hex');
  }
}

/** Generate a fresh attestation keypair (signer + verifier). */
export function createEd25519Attestation(): {
  signer: Ed25519AttestationSigner;
  verifier: Ed25519AttestationVerifier;
} {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    signer: new Ed25519AttestationSigner(privateKey, publicKey),
    verifier: new Ed25519AttestationVerifier(),
  };
}
