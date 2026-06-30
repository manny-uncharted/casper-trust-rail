import { describe, expect, it } from 'vitest';
import { createGeminiComplete, geminiAvailable } from '../src/llm/gemini.js';
import { LlmRiskAssessor } from '../src/oracle/RiskAssessor.js';
import type { TBillObservation } from '../src/oracle/TBillDataSource.js';

const obs: TBillObservation = {
  feedId: 'us-3m-tbill',
  label: 'US 3-Month T-Bill',
  ratePercent: 5.31,
  asOf: '2026-06-30T08:00:00Z',
  source: 'US Treasury Daily Par Yield',
};

describe('Gemini provider', () => {
  it('reports availability from an explicit key', () => {
    expect(geminiAvailable('a-key')).toBe(true);
    expect(geminiAvailable(undefined)).toBe(false);
  });

  it('throws a clear error when no key is configured', () => {
    expect(() => createGeminiComplete({ apiKey: '' })).toThrow(/api key/i);
  });

  it('plugs into LlmRiskAssessor and respects the heuristic floor on model failure', async () => {
    // A "Gemini-shaped" completion that errors → assessor falls back to heuristic.
    const failing = createGeminiComplete({ apiKey: 'test-key' });
    const assessor = new LlmRiskAssessor(failing);
    // No network in tests, so the lazy SDK import / call fails and the
    // deterministic floor stands (a nominal value posts).
    const result = await assessor.assess(obs, { now: Date.parse('2026-06-30T12:00:00Z') });
    expect(result.decision).toBe('post');
  });
});
