/**
 * Risk assessment for a candidate data point — the agent's "should I post this?"
 * brain.
 *
 * The default {@link HeuristicRiskAssessor} is deterministic (plausibility band,
 * deviation-from-last, staleness, monotonic time) so the pipeline is testable
 * and safe offline. {@link LlmRiskAssessor} layers an injected LLM on top for
 * meaningful agentic reasoning, falling back to the heuristic if the model is
 * unavailable or returns garbage — the deterministic floor always holds.
 */

import type { TBillObservation } from './TBillDataSource.js';

/** What the agent decided to do with an observation. */
export type RiskDecision = 'post' | 'flag' | 'escalate';

export interface RiskAssessment {
  readonly decision: RiskDecision;
  /** 0 (safe) … 1 (high risk). */
  readonly riskScore: number;
  readonly reasons: readonly string[];
  /** Model rationale, when an LLM was consulted. */
  readonly rationale?: string;
}

/** Prior context the assessor can use. */
export interface RiskContext {
  /** The last value posted for this feed (percent), if any. */
  readonly previousRatePercent?: number;
  /** When that previous value was observed (ms epoch), if any. */
  readonly previousAt?: number;
  /** Now (ms epoch). */
  readonly now: number;
}

export interface RiskAssessor {
  assess(observation: TBillObservation, context: RiskContext): Promise<RiskAssessment>;
}

export interface HeuristicThresholds {
  /** Plausible yield band (percent). Outside ⇒ escalate. Default 0–20. */
  readonly minRatePercent?: number;
  readonly maxRatePercent?: number;
  /** Abs deviation from previous (percentage points) that flags. Default 1.0. */
  readonly flagDeviation?: number;
  /** Abs deviation that escalates. Default 3.0. */
  readonly escalateDeviation?: number;
  /** Max observation age (ms) before flagging staleness. Default 36h. */
  readonly maxAgeMs?: number;
}

const DEFAULTS = {
  minRatePercent: 0,
  maxRatePercent: 20,
  flagDeviation: 1.0,
  escalateDeviation: 3.0,
  maxAgeMs: 36 * 60 * 60 * 1000,
} as const;

/** Deterministic, dependency-free risk scoring. */
export class HeuristicRiskAssessor implements RiskAssessor {
  private readonly t: Required<HeuristicThresholds>;

  constructor(thresholds: HeuristicThresholds = {}) {
    this.t = {
      minRatePercent: thresholds.minRatePercent ?? DEFAULTS.minRatePercent,
      maxRatePercent: thresholds.maxRatePercent ?? DEFAULTS.maxRatePercent,
      flagDeviation: thresholds.flagDeviation ?? DEFAULTS.flagDeviation,
      escalateDeviation: thresholds.escalateDeviation ?? DEFAULTS.escalateDeviation,
      maxAgeMs: thresholds.maxAgeMs ?? DEFAULTS.maxAgeMs,
    };
  }

  async assess(observation: TBillObservation, context: RiskContext): Promise<RiskAssessment> {
    const reasons: string[] = [];
    let risk = 0;
    let decision: RiskDecision = 'post';

    const rate = observation.ratePercent;

    if (Number.isNaN(rate) || !Number.isFinite(rate)) {
      return { decision: 'escalate', riskScore: 1, reasons: ['rate is not a finite number'] };
    }

    if (rate < this.t.minRatePercent || rate > this.t.maxRatePercent) {
      reasons.push(
        `rate ${rate}% outside plausible band [${this.t.minRatePercent}, ${this.t.maxRatePercent}]`,
      );
      risk = Math.max(risk, 0.95);
      decision = 'escalate';
    }

    if (context.previousRatePercent !== undefined) {
      const deviation = Math.abs(rate - context.previousRatePercent);
      if (deviation >= this.t.escalateDeviation) {
        reasons.push(`deviation ${deviation.toFixed(2)}pp ≥ escalate threshold`);
        risk = Math.max(risk, 0.85);
        decision = 'escalate';
      } else if (deviation >= this.t.flagDeviation) {
        reasons.push(`deviation ${deviation.toFixed(2)}pp ≥ flag threshold`);
        risk = Math.max(risk, 0.5);
        if (decision === 'post') decision = 'flag';
      } else {
        risk = Math.max(risk, Math.min(0.3, deviation / this.t.escalateDeviation));
      }
    }

    const observedAt = Date.parse(observation.asOf);
    if (!Number.isNaN(observedAt)) {
      const age = context.now - observedAt;
      if (age > this.t.maxAgeMs) {
        reasons.push(`observation is stale (${Math.round(age / 3.6e6)}h old)`);
        risk = Math.max(risk, 0.6);
        if (decision === 'post') decision = 'flag';
      }
    }

    if (reasons.length === 0) reasons.push('within band, deviation and freshness nominal');
    return { decision, riskScore: Number(risk.toFixed(3)), reasons };
  }
}

/** A minimal completion function — adapt any LLM/provider to this. */
export type LlmComplete = (prompt: string) => Promise<string>;

/** Layers an LLM judgment over the heuristic floor. */
export class LlmRiskAssessor implements RiskAssessor {
  private readonly complete: LlmComplete;
  private readonly floor: HeuristicRiskAssessor;

  constructor(complete: LlmComplete, floor: HeuristicRiskAssessor = new HeuristicRiskAssessor()) {
    this.complete = complete;
    this.floor = floor;
  }

  async assess(observation: TBillObservation, context: RiskContext): Promise<RiskAssessment> {
    const base = await this.floor.assess(observation, context);
    // The deterministic floor can only be made *stricter* by the model, never
    // looser — an LLM cannot talk the agent into posting something the rules
    // rejected.
    let rationale: string | undefined;
    try {
      const out = await this.complete(buildPrompt(observation, context, base));
      const parsed = parseLlm(out);
      rationale = parsed.rationale;
      if (parsed.decision && rank(parsed.decision) > rank(base.decision)) {
        return {
          decision: parsed.decision,
          riskScore: Math.max(base.riskScore, parsed.riskScore ?? base.riskScore),
          reasons: [...base.reasons, `llm escalated: ${parsed.rationale ?? 'no rationale'}`],
          ...(rationale ? { rationale } : {}),
        };
      }
    } catch {
      // Model unavailable — heuristic stands.
    }
    return rationale ? { ...base, rationale } : base;
  }
}

function rank(d: RiskDecision): number {
  return d === 'post' ? 0 : d === 'flag' ? 1 : 2;
}

function buildPrompt(o: TBillObservation, c: RiskContext, base: RiskAssessment): string {
  return [
    'You are a risk officer validating a real-world-asset data point before it is posted on-chain.',
    `Feed: ${o.feedId} (${o.label})`,
    `Proposed rate: ${o.ratePercent}% as of ${o.asOf}, source "${o.source}".`,
    c.previousRatePercent !== undefined ? `Previous posted rate: ${c.previousRatePercent}%.` : 'No prior value.',
    `Deterministic pre-check: decision=${base.decision}, risk=${base.riskScore}, reasons=${base.reasons.join('; ')}.`,
    'Reply as JSON: {"decision":"post|flag|escalate","riskScore":0..1,"rationale":"..."}.',
    'You may only keep or raise the severity, never lower it.',
  ].join('\n');
}

function parseLlm(
  out: string,
): { decision?: RiskDecision; riskScore?: number; rationale?: string } {
  const match = out.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const obj = JSON.parse(match[0]) as { decision?: string; riskScore?: number; rationale?: string };
    const decision =
      obj.decision === 'post' || obj.decision === 'flag' || obj.decision === 'escalate'
        ? obj.decision
        : undefined;
    return {
      ...(decision ? { decision } : {}),
      ...(typeof obj.riskScore === 'number' ? { riskScore: obj.riskScore } : {}),
      ...(typeof obj.rationale === 'string' ? { rationale: obj.rationale } : {}),
    };
  } catch {
    return {};
  }
}
