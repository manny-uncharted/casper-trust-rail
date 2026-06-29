/**
 * Result and config types for {@link TrustRailAgent}.
 */

import type { PostAttestation } from '../attestation/postAttestation.js';
import type { SanctionScreening } from '../sanctions/screener.js';
import type { RiskAssessment } from '../oracle/RiskAssessor.js';
import type { TBillObservation } from '../oracle/TBillDataSource.js';

/** Why a run did not result in an on-chain post. */
export type SkipReason = 'risk-escalated' | 'sanctions-blocked' | 'attestation-denied';

/** Outcome of a single agent run over one feed. */
export interface TrustRailPostResult {
  readonly feedId: string;
  readonly observation: TBillObservation;
  readonly assessment: RiskAssessment;
  readonly screening: SanctionScreening;
  readonly attestation: PostAttestation;
  /** The on-chain integer value posted (percent × 1e6). */
  readonly onChainValue: bigint;
  /** True when the data point was written on-chain. */
  readonly posted: boolean;
  /** Present when `posted`. */
  readonly deployHash?: string;
  readonly explorerUrl?: string;
  /** Present when the run was skipped. */
  readonly skipped?: SkipReason;
  readonly notes: readonly string[];
}

/** Result of scoring a prior post against ground truth and updating reputation. */
export interface OutcomeRecord {
  readonly agentId: string;
  readonly accurate: boolean;
  readonly errorPercent: number;
  readonly scoreBps: number;
  readonly deployHash: string;
  readonly explorerUrl: string;
}
