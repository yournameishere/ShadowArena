import { describe, expect, it } from 'vitest';
import { applyLiveSnapshot } from './live-state';
import { ShadowArenaSimulator } from './simulator';

describe('live ledger state projection', () => {
  it('projects the current player pending loss and phase from the public ledger', () => {
    const previous = new ShadowArenaSimulator().state;
    const next = applyLiveSnapshot(previous, {
      status: 1,
      round: 4,
      territories: ['A', 'A', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'B'],
      stateAOpen: true,
      stateBOpen: true,
      pendingLossA: 2,
      pendingLossB: 0,
      yourSide: 'A',
    });

    expect(next.phase).toBe('COMMIT_PHASE');
    expect(next.round).toBe(4);
    expect(next.publicStateOpen).toBe(true);
    expect(next.pendingLoss).toBe(2);
    expect(next.board[1]).toBe('A');
  });

  it('does not replace local private values when no player side is known', () => {
    const previous = { ...new ShadowArenaSimulator().state, pendingLoss: 1 };
    const next = applyLiveSnapshot(previous, {
      status: 0,
      round: 0,
      territories: previous.board,
      stateAOpen: false,
      stateBOpen: false,
      pendingLossA: 0,
      pendingLossB: 0,
    });

    expect(next.pendingLoss).toBe(1);
    expect(next.publicStateOpen).toBe(true);
  });
});
