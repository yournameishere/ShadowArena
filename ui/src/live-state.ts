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
  return {
    ...previous,
    phase,
    publicStateOpen,
    pendingLoss,
    round: snapshot.round || previous.round,
    board: snapshot.territories,
    events: previous.events.includes(chainEvent) ? previous.events : [chainEvent, ...previous.events],
    message: snapshot.yourSide ? `Public match state synced. You are Player ${snapshot.yourSide}.` : 'Public match state synced. Waiting for player assignment.',
  };
};
