import type { LiveLedgerSnapshot } from '@shadowarena/api';
import type { SimulationState } from './simulator';

export const phaseFromLedgerStatus = (status: number): SimulationState['phase'] =>
  status === 1 ? 'COMMIT_PHASE' : status === 2 ? 'REVEAL_PHASE' : status === 3 ? 'COMPLETE' : 'CREATED';

export const applyLiveSnapshot = (previous: SimulationState, snapshot: LiveLedgerSnapshot): SimulationState => {
  const phase = phaseFromLedgerStatus(snapshot.status);
  const chainEvent = `On-chain state synced · round ${snapshot.round}`;
  const publicStateOpen = snapshot.yourSide === 'A'
    ? snapshot.stateAOpen
    : snapshot.yourSide === 'B'
      ? snapshot.stateBOpen
      : previous.publicStateOpen;
  const pendingLoss = snapshot.yourSide === 'A'
    ? snapshot.pendingLossA
    : snapshot.yourSide === 'B'
      ? snapshot.pendingLossB
      : previous.pendingLoss;
  const winner = snapshot.winnerSide;
  const resultEvent = snapshot.status === 3 && snapshot.winnerSide
    ? `Match complete · Player ${snapshot.winnerSide} won`
    : undefined;
  const knownSide = snapshot.yourSide && snapshot.winnerSide;
  const message = snapshot.status === 3 && snapshot.winnerSide
    ? knownSide
      ? snapshot.winnerSide === snapshot.yourSide
        ? 'Victory. The match is settled on-chain in your favour.'
        : 'Defeat. Your opponent won this live match.'
      : `Match complete · Player ${snapshot.winnerSide} won.`
    : snapshot.yourSide
      ? `Public match state synced. You are Player ${snapshot.yourSide}.`
      : 'Public match state synced. Waiting for player assignment.';
  return {
    ...previous,
    phase,
    publicStateOpen,
    pendingLoss,
    winner,
    round: snapshot.round || previous.round,
    board: snapshot.territories,
    events: previous.events.includes(chainEvent)
      ? previous.events
      : resultEvent
        ? [resultEvent, chainEvent, ...previous.events]
        : [chainEvent, ...previous.events],
    message,
  };
};
