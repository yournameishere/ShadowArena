import { describe, expect, it } from 'vitest';
import { toHex } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { toLedgerSnapshot } from './live.js';

describe('live ledger projection', () => {
  it('serializes byte public keys as stable hex instead of array-string values', () => {
    const playerA = new Uint8Array(32).fill(7);
    const snapshot = toLedgerSnapshot({
      status: 1n,
      round: 2n,
      territories: { lookup: () => 'A' },
      playerA: { is_some: true, value: playerA },
      playerB: { is_some: false, value: playerA },
      stateA: { is_some: true },
      stateB: { is_some: false },
      pendingLossA: 1n,
      pendingLossB: 0n,
      winner: { is_some: false, value: playerA },
    });

    expect(snapshot.playerA).toBe(toHex(playerA));
    expect(snapshot.playerA).not.toContain(',');
    expect(snapshot.pendingLossA).toBe(1);
  });
});
