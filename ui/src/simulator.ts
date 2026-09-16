import {
  BASE_B,
  CARD_TYPES,
  START_RESOURCES,
  START_TROOPS,
  WIN_TERRITORIES,
  cardCost,
  hasCapture,
  lossFor,
  territoryName,
  validateMove,
  type Action,
  type CardType,
  type MatchPhase,
  type Move,
  type TerritoryOwner,
} from '@shadowarena/api/game';

export type SimulationState = {
  readonly phase: MatchPhase;
  readonly publicStateOpen: boolean;
  readonly round: number;
  readonly board: readonly TerritoryOwner[];
  readonly resources: number;
  readonly troops: number;
  readonly pendingLoss: number;
  readonly hand: readonly CardType[];
  readonly usedCards: readonly CardType[];
  readonly committedMove?: Move;
  readonly opponentMove?: Move;
  readonly winner?: 'A' | 'B';
  readonly message: string;
  readonly events: readonly string[];
};

const initialBoard: TerritoryOwner[] = ['A', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'B'];

const initialState = (): SimulationState => ({
  phase: 'COMMIT_PHASE',
  publicStateOpen: true,
  round: 1,
  board: initialBoard,
  resources: START_RESOURCES,
  troops: START_TROOPS,
  pendingLoss: 0,
  hand: [CARD_TYPES[3], CARD_TYPES[1], CARD_TYPES[4]],
  usedCards: [],
  message: 'Choose a private move. Your opponent cannot see it.',
  events: ['Match created', 'Your private state is ready'],
});

const opponentFor = (move: Move): Move => {
  if (move.action === 'ATTACK') return { action: 'DEFEND', origin: BASE_B, territory: move.territory, troops: 0, card: 'Shield' };
  if (move.action === 'RECON') return { action: 'PASS', origin: BASE_B, territory: BASE_B, troops: 0 };
  return { action: 'PASS', origin: BASE_B, territory: BASE_B, troops: 0 };
};

export class ShadowArenaSimulator {
  private current: SimulationState = initialState();

  get state(): SimulationState { return this.current; }

  reset(): SimulationState {
    this.current = initialState();
    return this.current;
  }

  commit(move: Move): SimulationState {
    if (this.current.phase !== 'COMMIT_PHASE') return this.withMessage('Reveal the committed move before choosing another one.');
    if (this.current.pendingLoss > 0) return this.withMessage('Settle the pending troop losses before committing another move.');
    const valid = validateMove(move, 'A', this.current.board, this.current.resources, this.current.troops, this.current.hand, this.current.usedCards);
    if (!valid.valid) return this.withMessage(valid.reason);
    const opponentMove = opponentFor(move);
    this.current = {
      ...this.current,
      phase: 'REVEAL_PHASE',
      committedMove: move,
      opponentMove,
      message: 'Move committed. Reveal it to resolve the round.',
      events: [`Round ${this.current.round}: commitment sealed`, ...this.current.events],
    };
    return this.current;
  }

  reveal(): SimulationState {
    const mine = this.current.committedMove;
    const theirs = this.current.opponentMove;
    if (this.current.phase !== 'REVEAL_PHASE' || !mine || !theirs) return this.withMessage('Commit a move before revealing it.');

    const cost = cardCost(mine.action, mine.card);
    const healed = mine.card === 'Heal' ? 10 : 0;
    const built = mine.action === 'BUILD' || mine.card === 'Rally' ? 1 : 0;
    const losses = lossFor(mine, theirs);
    const nextBoard = [...this.current.board];
    if (hasCapture(mine, theirs)) nextBoard[mine.territory] = 'A';
    const captured = nextBoard.filter((owner) => owner === 'A').length;
    const won = mine.territory === BASE_B || captured >= WIN_TERRITORIES;
    const usedCards = mine.card ? [...this.current.usedCards, mine.card] : [...this.current.usedCards];
    const nextResources = this.current.resources + healed - cost;
    const nextTroops = this.current.troops + built;
    if (nextTroops < losses) return this.withMessage('This round would leave you without enough troops to absorb the losses.');
    const event = hasCapture(mine, theirs)
      ? `Round ${this.current.round}: ${territoryName(mine.territory)} captured`
      : `Round ${this.current.round}: moves resolved without a capture`;

    this.current = {
      ...this.current,
      phase: won ? 'COMPLETE' : 'COMMIT_PHASE',
      round: won ? this.current.round : this.current.round + 1,
      board: nextBoard,
      resources: nextResources,
      troops: nextTroops,
      pendingLoss: losses,
      usedCards,
      committedMove: undefined,
      opponentMove: undefined,
      winner: won ? 'A' : undefined,
      message: won ? 'You won the rehearsal. The base is yours.' : 'Round resolved. Choose your next private move.',
      events: [event, 'Private state updated locally for this rehearsal', ...this.current.events],
    };
    return this.current;
  }

  settle(): SimulationState {
    if (this.current.pendingLoss <= 0) return this.withMessage('There are no pending losses to settle.');
    this.current = {
      ...this.current,
      troops: this.current.troops - this.current.pendingLoss,
      pendingLoss: 0,
      message: 'Losses settled. Choose your next private move.',
      events: ['Private troop losses settled', ...this.current.events],
    };
    return this.current;
  }

  private withMessage(message: string): SimulationState {
    this.current = { ...this.current, message };
    return this.current;
  }
}

export const actionLabel: Record<Action, string> = {
  RECON: 'Recon',
  ATTACK: 'Attack',
  DEFEND: 'Defend',
  BUILD: 'Build',
  PASS: 'Pass',
};
