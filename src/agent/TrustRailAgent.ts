/**
 * TrustRailAgent — the autonomous RWA oracle.
 *
 * One run, end to end:
 *
 *   fetch → risk-assess → sanctions-screen → attest → post on-chain → confirm
 *
 * Each step composes a focused primitive:
 * - sanctions screening via {@link OracleSanctionScreener} (real-time, fail-closed);
 * - cryptographic post authorization via {@link PostAttestation} — a signed
 *   `allow` verdict bound to the exact value being posted, checked by
 *   {@link PostAttestationGuard} before the on-chain write. The verdict's intent
 *   hash is what we store on-chain as the data point's `attestation_hash`, so a
 *   consumer can match the value back to the signed evidence that produced it.
 *
 * Posting is fail-closed: an escalated risk decision, a blocked counterparty, or
 * a denied/withheld attestation all skip the write rather than guess.
 */

import {
  PostAttestationGuard,
  computePostIntentHash,
  signPostAttestation,
  type AttestationSigner,
  type AttestationVerifier,
  type PostIntent,
  type PostAttestation,
} from '../attestation/postAttestation.js';
import type { Counterparty, SanctionScreener, SanctionScreening } from '../sanctions/screener.js';
import type { CasperClient } from '../casper/CasperClient.js';
import {
  HeuristicRiskAssessor,
  type RiskAssessment,
  type RiskAssessor,
} from '../oracle/RiskAssessor.js';
import { ReputationTracker } from '../oracle/ReputationTracker.js';
import { toOnChainValue, type TBillDataSource } from '../oracle/TBillDataSource.js';
import type { OutcomeRecord, TrustRailPostResult } from './types.js';

export interface TrustRailAgentConfig {
  /** The agent's on-chain identity id (must be registered in AgentIdentity). */
  readonly agentId: string;
  /** Casper network label used in attestation intents, e.g. `"casper:casper-test"`. */
  readonly network: string;
  /** The account the agent settles to / on behalf of (screened before posting). */
  readonly payTo: string;
  readonly casper: CasperClient;
  readonly dataSource: TBillDataSource;
  readonly screener: SanctionScreener;
  readonly attestationSigner: AttestationSigner;
  readonly attestationVerifier: AttestationVerifier;
  /** Defaults to a deterministic {@link HeuristicRiskAssessor}. */
  readonly riskAssessor?: RiskAssessor;
  readonly reputationTracker?: ReputationTracker;
  /** Attestation guard mode. Default `"enforce"` — no attestation, no post. */
  readonly attestationMode?: 'enforce' | 'warn';
  /** Attestation validity window (ms). Default 5 minutes. */
  readonly attestationTtlMs?: number;
  readonly now?: () => number;
}

export class TrustRailAgent {
  private readonly cfg: TrustRailAgentConfig;
  private readonly risk: RiskAssessor;
  private readonly reputation: ReputationTracker;
  private readonly guard: PostAttestationGuard;
  private readonly now: () => number;
  /** Last posted rate per feed, for deviation-based risk. */
  private readonly lastPosted = new Map<string, { ratePercent: number; at: number }>();

  constructor(config: TrustRailAgentConfig) {
    this.cfg = config;
    this.risk = config.riskAssessor ?? new HeuristicRiskAssessor();
    this.reputation = config.reputationTracker ?? new ReputationTracker();
    this.now = config.now ?? Date.now;
    this.guard = new PostAttestationGuard({
      verifier: config.attestationVerifier,
      mode: config.attestationMode ?? 'enforce',
      now: this.now,
    });
  }

  /** Register the agent's identity on-chain. Idempotent at the contract level. */
  async registerIdentity(metadata: string): Promise<{ deployHash: string; explorerUrl: string }> {
    const res = await this.cfg.casper.registerAgent(this.cfg.agentId, metadata);
    await this.cfg.casper.confirm(res);
    return { deployHash: res.deployHash, explorerUrl: this.cfg.casper.explorerUrl(res.deployHash) };
  }

  /** Run the full pipeline once for a feed. */
  async runOnce(feedId: string): Promise<TrustRailPostResult> {
    const notes: string[] = [];
    const observation = await this.cfg.dataSource.fetch(feedId);
    const onChainValue = toOnChainValue(observation.ratePercent);

    // 1. Risk assessment.
    const prev = this.lastPosted.get(feedId);
    const assessment: RiskAssessment = await this.risk.assess(observation, {
      now: this.now(),
      ...(prev ? { previousRatePercent: prev.ratePercent, previousAt: prev.at } : {}),
    });
    notes.push(`risk: ${assessment.decision} (${assessment.riskScore}) — ${assessment.reasons.join('; ')}`);

    if (assessment.decision === 'escalate') {
      return this.skip(feedId, observation, assessment, clearScreening(this.now()), onChainValue, 'risk-escalated', notes);
    }

    // 2. Sanctions screening of the settlement counterparty.
    const counterparty: Counterparty = {
      id: `casper:${this.cfg.payTo}`,
      chain: this.cfg.network,
      address: this.cfg.payTo,
      label: 'trust-rail-beneficiary',
    };
    const screening = await this.cfg.screener.screen(counterparty);
    notes.push(`sanctions: ${screening.verdict} (${screening.provider})`);
    if (screening.verdict === 'blocked') {
      return this.skip(feedId, observation, assessment, screening, onChainValue, 'sanctions-blocked', notes);
    }

    // 3. Cryptographic attestation bound to the exact value being posted.
    const intent: PostIntent = {
      chain: this.cfg.network,
      oracle: this.cfg.casper.oracleContractHash(),
      feedId,
      value: onChainValue.toString(),
      nonce: this.now(),
    };
    const intentHash = await computePostIntentHash(intent);
    const attestation = await this.buildAttestation(intentHash, assessment);

    const decision = await this.guard.authorize({ intentHash, attestation });
    if (!decision.allowed) {
      notes.push(`attestation denied: ${decision.reasons.join('; ')}`);
      return this.skip(feedId, observation, assessment, screening, onChainValue, 'attestation-denied', notes);
    }
    if (!decision.verified) notes.push(`attestation warnings: ${decision.warnings.join('; ')}`);

    // 4. Post on-chain. The intent hash is the on-chain attestation_hash.
    const res = await this.cfg.casper.postDataPoint({
      feedId,
      value: onChainValue,
      source: observation.source,
      attestationHash: intentHash,
      agentId: this.cfg.agentId,
    });
    await this.cfg.casper.confirm(res);
    this.lastPosted.set(feedId, { ratePercent: observation.ratePercent, at: this.now() });
    notes.push(`posted: ${res.deployHash}`);

    return {
      feedId,
      observation,
      assessment,
      screening,
      attestation,
      onChainValue,
      posted: true,
      deployHash: res.deployHash,
      explorerUrl: this.cfg.casper.explorerUrl(res.deployHash),
      notes,
    };
  }

  /**
   * Score a previously posted value against ground truth and write the outcome
   * to the on-chain reputation contract.
   */
  async recordOutcome(
    postedRatePercent: number,
    groundTruthPercent: number,
  ): Promise<OutcomeRecord> {
    const score = this.reputation.score(postedRatePercent, groundTruthPercent);
    const local = this.reputation.record(this.cfg.agentId, score.accurate);
    const res = await this.cfg.casper.recordOutcome(this.cfg.agentId, score.accurate);
    await this.cfg.casper.confirm(res);
    return {
      agentId: this.cfg.agentId,
      accurate: score.accurate,
      errorPercent: score.errorPercent,
      scoreBps: local.scoreBps,
      deployHash: res.deployHash,
      explorerUrl: this.cfg.casper.explorerUrl(res.deployHash),
    };
  }

  private async buildAttestation(
    intentHash: string,
    assessment: RiskAssessment,
  ): Promise<PostAttestation> {
    const issuedAt = this.now();
    const base: PostAttestation = {
      intentHash,
      verdict: 'allow',
      riskScore: assessment.riskScore,
      policyId: 'trust-rail/rwa-oracle@1',
      issuedAt,
      expiresAt: issuedAt + (this.cfg.attestationTtlMs ?? 5 * 60_000),
    };
    return signPostAttestation(base, this.cfg.attestationSigner);
  }

  private skip(
    feedId: string,
    observation: TrustRailPostResult['observation'],
    assessment: RiskAssessment,
    screening: SanctionScreening,
    onChainValue: bigint,
    reason: TrustRailPostResult['skipped'],
    notes: string[],
  ): TrustRailPostResult {
    const placeholder: PostAttestation = {
      intentHash: '',
      verdict: reason === 'attestation-denied' ? 'deny' : 'allow',
      issuedAt: this.now(),
    };
    return {
      feedId,
      observation,
      assessment,
      screening,
      attestation: placeholder,
      onChainValue,
      posted: false,
      ...(reason ? { skipped: reason } : {}),
      notes,
    };
  }
}

function clearScreening(now: number): SanctionScreening {
  return { verdict: 'clear', reasons: ['not screened — skipped before screening'], provider: 'n/a', evaluatedAt: now };
}
