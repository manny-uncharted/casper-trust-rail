/**
 * Scores posted data points against later ground truth and turns each outcome
 * into an on-chain reputation update.
 *
 * The agent posts a value, then — once the authoritative figure is known (the
 * next official release) — calls {@link ReputationTracker.score} to decide
 * whether the post was accurate within tolerance. The result feeds
 * `Reputation.record_outcome` on Casper, so the agent's track record is public
 * and verifiable rather than self-reported.
 */

export interface ReputationTrackerOptions {
  /** Tolerance (percentage points) within which a post counts as accurate. Default 0.05. */
  readonly tolerancePercent?: number;
}

export interface OutcomeScore {
  readonly accurate: boolean;
  /** Abs error in percentage points. */
  readonly errorPercent: number;
  readonly tolerancePercent: number;
}

/** A locally-mirrored running accuracy, matching the on-chain bps model. */
export interface LocalReputation {
  total: number;
  correct: number;
  /** Basis points, 0..10000. */
  scoreBps: number;
}

export class ReputationTracker {
  private readonly tolerance: number;
  private readonly local = new Map<string, LocalReputation>();

  constructor(options: ReputationTrackerOptions = {}) {
    this.tolerance = options.tolerancePercent ?? 0.05;
  }

  /** Decide whether a posted rate matched ground truth within tolerance. */
  score(postedRatePercent: number, groundTruthPercent: number): OutcomeScore {
    const errorPercent = Math.abs(postedRatePercent - groundTruthPercent);
    return {
      accurate: errorPercent <= this.tolerance,
      errorPercent: Number(errorPercent.toFixed(6)),
      tolerancePercent: this.tolerance,
    };
  }

  /** Fold an outcome into the local mirror and return the new running state. */
  record(agentId: string, accurate: boolean): LocalReputation {
    const cur = this.local.get(agentId) ?? { total: 0, correct: 0, scoreBps: 5000 };
    const total = cur.total + 1;
    const correct = cur.correct + (accurate ? 1 : 0);
    const scoreBps = Math.floor((correct * 10000) / total);
    const next: LocalReputation = { total, correct, scoreBps };
    this.local.set(agentId, next);
    return next;
  }

  /** Current local mirror for an agent (neutral default if unseen). */
  reputationOf(agentId: string): LocalReputation {
    return this.local.get(agentId) ?? { total: 0, correct: 0, scoreBps: 5000 };
  }
}
