import { describe, expect, it } from 'vitest';
import { ReputationTracker } from '../src/oracle/ReputationTracker.js';

describe('ReputationTracker', () => {
  it('scores within tolerance as accurate', () => {
    const t = new ReputationTracker({ tolerancePercent: 0.05 });
    expect(t.score(5.31, 5.33).accurate).toBe(true);
    expect(t.score(5.31, 5.5).accurate).toBe(false);
  });

  it('mirrors the on-chain bps model', () => {
    const t = new ReputationTracker();
    t.record('agent', true);
    t.record('agent', true);
    t.record('agent', false);
    const rep = t.record('agent', true);
    expect(rep.total).toBe(4);
    expect(rep.correct).toBe(3);
    expect(rep.scoreBps).toBe(7500);
  });

  it('defaults unseen agents to neutral', () => {
    const t = new ReputationTracker();
    expect(t.reputationOf('nobody').scoreBps).toBe(5000);
  });
});
