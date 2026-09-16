import { describe, expect, it } from 'vitest';
import { ShadowArenaSimulator } from './simulator';

describe('ShadowArena rehearsal lifecycle', () => {
  it('carries pending losses into settlement before the next round', () => {
    const simulator = new ShadowArenaSimulator();

    const committed = simulator.commit({ action: 'ATTACK', origin: 0, territory: 1, troops: 2 });
    expect(committed.phase).toBe('REVEAL_PHASE');

    const resolved = simulator.reveal();
    expect(resolved.phase).toBe('COMMIT_PHASE');
    expect(resolved.pendingLoss).toBe(1);
    expect(resolved.troops).toBe(3);

    const settled = simulator.settle();
    expect(settled.pendingLoss).toBe(0);
    expect(settled.troops).toBe(2);
  });

  it('rejects an illegal move without advancing the phase', () => {
    const simulator = new ShadowArenaSimulator();
    const result = simulator.commit({ action: 'ATTACK', origin: 1, territory: 2, troops: 2 });

    expect(result.phase).toBe('COMMIT_PHASE');
    expect(result.message).toContain('origin must be one of your territories');
  });

  it('marks a played card as unavailable for later moves', () => {
    const simulator = new ShadowArenaSimulator();
    simulator.commit({ action: 'ATTACK', origin: 0, territory: 1, troops: 2, card: 'Ambush' });
    const result = simulator.reveal();

    expect(result.usedCards).toContain('Ambush');
    expect(result.hand).toContain('Ambush');
  });
});
