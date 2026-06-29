import { describe, expect, it } from 'vitest';
import {
  PostAttestationGuard,
  computePostIntentHash,
  signPostAttestation,
  type PostAttestation,
} from '../src/attestation/postAttestation.js';
import { createEd25519Attestation } from '../src/attestation/Ed25519Attestation.js';

describe('Ed25519 attestation + PostAttestationGuard', () => {
  it('signs and verifies an attestation bound to a post intent', async () => {
    const { signer, verifier } = createEd25519Attestation();
    const intentHash = await computePostIntentHash({
      chain: 'casper:casper-test',
      oracle: 'hash-oracle',
      feedId: 'us-3m-tbill',
      value: '5310000',
    });

    const attestation = await signPostAttestation(
      { intentHash, verdict: 'allow', issuedAt: Date.now() },
      signer,
    );
    expect(attestation.signature).toBeTruthy();
    expect(attestation.verificationMethod).toContain('ed25519:');

    const guard = new PostAttestationGuard({ verifier, mode: 'enforce' });
    const decision = await guard.authorize({ intentHash, attestation });
    expect(decision.allowed).toBe(true);
    expect(decision.verified).toBe(true);
  });

  it('rejects an attestation bound to a different intent', async () => {
    const { signer, verifier } = createEd25519Attestation();
    const attestation = await signPostAttestation(
      { intentHash: 'hash-A', verdict: 'allow', issuedAt: Date.now() },
      signer,
    );
    const guard = new PostAttestationGuard({ verifier, mode: 'enforce' });
    const decision = await guard.authorize({ intentHash: 'hash-B', attestation });
    expect(decision.allowed).toBe(false);
  });

  it('rejects a tampered signature', async () => {
    const { signer, verifier } = createEd25519Attestation();
    const attestation = await signPostAttestation(
      { intentHash: 'hash-A', verdict: 'allow', issuedAt: Date.now() },
      signer,
    );
    const tampered: PostAttestation = { ...attestation, signature: '00'.repeat(64) };
    const guard = new PostAttestationGuard({ verifier, mode: 'enforce' });
    const decision = await guard.authorize({ intentHash: 'hash-A', attestation: tampered });
    expect(decision.allowed).toBe(false);
  });
});
