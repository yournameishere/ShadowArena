import {
  CostModel,
  QueryContext,
  createConstructorContext,
  ownPublicKey,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import {
  Contract,
  MatchStatus,
  Owner,
  ledger,
  pureCircuits,
} from '../managed/shadowarena/contract/index.js';
import { createShadowArenaPrivateState, witnesses } from '../witnesses.js';

const makeContext = (contract: Contract<any>, secretKey: Uint8Array) => {
  const initial = contract.initialState(
    createConstructorContext(
      createShadowArenaPrivateState(secretKey, [0n, 1n, 2n]),
      { bytes: new Uint8Array(32).fill(secretKey[0]) },
    ),
  );
  return {
    currentPrivateState: initial.currentPrivateState,
    currentZswapLocalState: initial.currentZswapLocalState,
    costModel: CostModel.initialCostModel(),
    currentQueryContext: new QueryContext(initial.currentContractState.data, sampleContractAddress()),
  };
};

describe('ShadowArena compiled contract', () => {
  it('initializes the board and exposes the expected pure rule', () => {
    const contract = new Contract(witnesses);
    const context = makeContext(contract, new Uint8Array(32).fill(1));
    const state = ledger(context.currentQueryContext.state);

    expect(state.status).toBe(MatchStatus.CREATED);
    expect(state.round).toBe(0n);
    expect(state.territories.lookup(0n)).toBe(Owner.A);
    expect(state.territories.lookup(1n)).toBe(Owner.NEUTRAL);
    expect(state.territories.lookup(14n)).toBe(Owner.B);
    expect(pureCircuits.adjacent(0n, 1n)).toBe(true);
    expect(pureCircuits.adjacent(0n, 6n)).toBe(false);
  });

  it('runs the create, open, and commit lifecycle for a player', () => {
    const contract = new Contract(witnesses);
    const secretKey = new Uint8Array(32).fill(3);
    let context = makeContext(contract, secretKey);
    const opponent = new Uint8Array(32).fill(4);

    context = contract.impureCircuits.createMatch(context, opponent).context;
    context = contract.impureCircuits.openState(context).context;
    context = contract.impureCircuits.submitCommit(context, 4, 0n, 0n, 0n, { is_some: false, value: 0n }).context;

    const state = ledger(context.currentQueryContext.state);
    expect(state.status).toBe(MatchStatus.COMMIT_PHASE);
    expect(state.playerA.is_some).toBe(true);
    expect(state.stateA.is_some).toBe(true);
    expect(state.commitA.is_some).toBe(true);
    expect(context.currentPrivateState.moveSalt).not.toEqual(context.currentPrivateState.committedMoveSalt);
  });

  it('advances the private witness state after a revealed move', () => {
    const contract = new Contract(witnesses);
    let context = makeContext(contract, new Uint8Array(32).fill(5));
    const playerB = makeContext(contract, new Uint8Array(32).fill(6));
    let playerAPrivateState = context.currentPrivateState;
    let playerAZswap = context.currentZswapLocalState;
    let playerBPrivateState = playerB.currentPrivateState;
    let playerBZswap = playerB.currentZswapLocalState;
    const switchToA = () => {
      context.currentPrivateState = playerAPrivateState;
      context.currentZswapLocalState = playerAZswap;
    };
    const switchToB = () => {
      context.currentPrivateState = playerBPrivateState;
      context.currentZswapLocalState = playerBZswap;
    };

    context = contract.impureCircuits.createMatch(context, ownPublicKey(playerB).bytes).context;
    context = contract.impureCircuits.openState(context).context;
    playerAPrivateState = context.currentPrivateState;
    playerAZswap = context.currentZswapLocalState;
    switchToB();
    context = contract.impureCircuits.openState(context).context;
    playerBPrivateState = context.currentPrivateState;
    playerBZswap = context.currentZswapLocalState;
    switchToA();

    context = contract.impureCircuits.submitCommit(context, 1, 0n, 1n, 2n, { is_some: false, value: 0n }).context;
    playerAPrivateState = context.currentPrivateState;
    playerAZswap = context.currentZswapLocalState;
    switchToB();
    context = contract.impureCircuits.submitCommit(context, 4, 14n, 14n, 0n, { is_some: false, value: 0n }).context;
    playerBPrivateState = context.currentPrivateState;
    playerBZswap = context.currentZswapLocalState;
    switchToA();

    context = contract.impureCircuits.revealMove(context, 1, 0n, 1n, 2n, { is_some: false, value: 0n }).context;
    playerAPrivateState = context.currentPrivateState;
    playerAZswap = context.currentZswapLocalState;
    expect(context.currentPrivateState.resources).toBe(90n);
    expect(context.currentPrivateState.troops).toBe(3n);
    expect(ledger(context.currentQueryContext.state).moveA.is_some).toBe(true);
  });

  it('keeps private state shaped for the witness boundary', () => {
    const state = createShadowArenaPrivateState(new Uint8Array(32).fill(9), [0n, 1n, 2n]);
    expect(state.resources).toBe(100n);
    expect(state.troops).toBe(3n);
    expect(state.cards).toEqual([0n, 1n, 2n]);
    expect(state.moveSalt).toHaveLength(32);
    expect(state.committedMoveSalt).toHaveLength(32);
  });

  it('records an explicit player forfeit on-chain', () => {
    const contract = new Contract(witnesses);
    let context = makeContext(contract, new Uint8Array(32).fill(12));
    context = contract.impureCircuits.createMatch(context, new Uint8Array(32).fill(13)).context;
    context = contract.impureCircuits.openState(context).context;
    context = contract.impureCircuits.forfeit(context).context;
    const state = ledger(context.currentQueryContext.state);
    expect(state.status).toBe(MatchStatus.COMPLETE);
    expect(state.winner.is_some).toBe(true);
    expect(state.winner.value).toEqual(new Uint8Array(32).fill(13));
  });
});
