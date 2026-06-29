import { describe, expect, it } from 'vitest';
import {
  HeuristicRiskAssessor,
  LlmRiskAssessor,
} from '../src/oracle/RiskAssessor.js';
import type { TBillObservation } from '../src/oracle/TBillDataSource.js';

const NOW = Date.parse('2026-06-27T12:00:00Z');

function obs(ratePercent: number, asOf = '2026-06-27T08:00:00Z'): TBillObservation {
  return {
    feedId: 'us-3m-tbill',
    label: 'US 3-Month T-Bill',
    ratePercent,
    asOf,
    source: 'US Treasury Daily Par Yield',
  };
}

describe('HeuristicRiskAssessor', () => {
  const assessor = new HeuristicRiskAssessor();

  it('posts a nominal, fresh value', async () => {
    const r = await assessor.assess(obs(5.31), { now: NOW });
    expect(r.decision).toBe('post');
    expect(r.riskScore).toBeLessThan(0.3);
  });

  it('escalates an implausible rate', async () => {
    const r = await assessor.assess(obs(42), { now: NOW });
    expect(r.decision).toBe('escalate');
    expect(r.riskScore).toBeGreaterThan(0.9);
  });

  it('flags a moderate deviation from the previous value', async () => {
    const r = await assessor.assess(obs(6.8), { now: NOW, previousRatePercent: 5.3 });
    expect(r.decision).toBe('flag');
  });

  it('escalates a large deviation', async () => {
    const r = await assessor.assess(obs(9.0), { now: NOW, previousRatePercent: 5.3 });
    expect(r.decision).toBe('escalate');
  });

  it('flags a stale observation', async () => {
    const r = await assessor.assess(obs(5.31, '2026-06-20T08:00:00Z'), { now: NOW });
    expect(r.decision).toBe('flag');
    expect(r.reasons.some((x) => x.includes('stale'))).toBe(true);
  });
});

describe('LlmRiskAssessor', () => {
  it('lets the LLM raise severity but never lower it', async () => {
    const escalateModel = new LlmRiskAssessor(async () =>
      JSON.stringify({ decision: 'escalate', riskScore: 0.9, rationale: 'source feed looks spoofed' }),
    );
    const r = await escalateModel.assess(obs(5.31), { now: NOW });
    expect(r.decision).toBe('escalate');
    expect(r.rationale).toContain('spoofed');
  });

  it('keeps the heuristic decision when the LLM tries to downgrade', async () => {
    // Heuristic escalates (42%); model says "post" — must be ignored.
    const downgradeModel = new LlmRiskAssessor(async () =>
      JSON.stringify({ decision: 'post', riskScore: 0, rationale: 'looks fine to me' }),
    );
    const r = await downgradeModel.assess(obs(42), { now: NOW });
    expect(r.decision).toBe('escalate');
  });

  it('falls back to the heuristic when the model throws', async () => {
    const brokenModel = new LlmRiskAssessor(async () => {
      throw new Error('model offline');
    });
    const r = await brokenModel.assess(obs(5.31), { now: NOW });
    expect(r.decision).toBe('post');
  });
});
