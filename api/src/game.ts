export const BOARD_WIDTH = 5;
export const BOARD_SIZE = 15;
export const BASE_A = 0;
export const BASE_B = 14;
export const START_RESOURCES = 100;
export const START_TROOPS = 3;
export const WIN_TERRITORIES = 5;

export const CARD_TYPES = [
  'Attack boost',
  'Shield',
  'Heal',
  'Ambush',
  'Spy',
  'Teleport',
  'Counter',
  'Rally',
] as const;

export type CardType = (typeof CARD_TYPES)[number];
export type PlayerSide = 'A' | 'B';
export type TerritoryOwner = PlayerSide | 'neutral';
export type Action = 'RECON' | 'ATTACK' | 'DEFEND' | 'BUILD' | 'PASS';
export type MatchPhase = 'CREATED' | 'COMMIT_PHASE' | 'REVEAL_PHASE' | 'COMPLETE';

export type Move = {
  readonly action: Action;
  readonly origin: number;
  readonly territory: number;
  readonly troops: number;
  readonly card?: CardType;
};

export type ValidationResult = { readonly valid: true } | { readonly valid: false; readonly reason: string };

export type PublicMove = Move & { readonly player: PlayerSide };

export const territoryName = (id: number): string => String.fromCharCode(65 + id);

export const isAdjacent = (a: number, b: number): boolean => {
  if (a < 0 || b < 0 || a >= BOARD_SIZE || b >= BOARD_SIZE) return false;
  const sameRow = Math.floor(a / BOARD_WIDTH) === Math.floor(b / BOARD_WIDTH);
  return (sameRow && Math.abs(a - b) === 1) || Math.abs(a - b) === BOARD_WIDTH;
};

export const cardCost = (action: Action, card?: CardType): number => {
  if (action === 'RECON') return 5;
  if (action === 'ATTACK') return card === 'Spy' ? 0 : 10;
  if (action === 'DEFEND') return 5;
  if (action === 'BUILD') return 15;
  return 0;
};

export const cardIndex = (card: CardType): number => CARD_TYPES.indexOf(card);

export const validateMove = (
  move: Move,
  side: PlayerSide,
  board: readonly TerritoryOwner[],
  resources: number,
  troopsAvailable: number,
  hand: readonly CardType[],
  usedCards: readonly CardType[] = [],
): ValidationResult => {
  if (!Number.isInteger(move.origin) || !Number.isInteger(move.territory)) return { valid: false, reason: 'Choose valid territories.' };
  if (move.origin < 0 || move.origin >= BOARD_SIZE || move.territory < 0 || move.territory >= BOARD_SIZE) return { valid: false, reason: 'Choose valid territories.' };
  if (!Number.isInteger(move.troops) || move.troops < 0 || move.troops > 9) return { valid: false, reason: 'Troop count must be between 0 and 9.' };
  if (move.card && (!hand.includes(move.card) || usedCards.includes(move.card))) return { valid: false, reason: 'That card is not available.' };
  if (resources < cardCost(move.action, move.card)) return { valid: false, reason: 'Not enough resources for this action.' };

  if (move.action === 'RECON' || move.action === 'ATTACK') {
    if (board[move.origin] !== side) return { valid: false, reason: 'The origin must be one of your territories.' };
    if (move.action === 'ATTACK' && move.card !== 'Teleport' && !isAdjacent(move.origin, move.territory)) return { valid: false, reason: 'Attack from an adjacent territory or use Teleport.' };
    if (move.action === 'RECON' && !isAdjacent(move.origin, move.territory)) return { valid: false, reason: 'Recon must target an adjacent territory.' };
    if (board[move.territory] === side) return { valid: false, reason: 'Choose an enemy or neutral territory.' };
    if (move.action === 'ATTACK' && (move.troops < 2 || move.troops > troopsAvailable)) return { valid: false, reason: 'Attack with at least 2 available troops.' };
  }
  if (move.action === 'DEFEND' || move.action === 'BUILD') {
    if (board[move.territory] !== side) return { valid: false, reason: 'Choose one of your territories.' };
  }
  if (move.card && ['Attack boost', 'Ambush', 'Spy', 'Teleport'].includes(move.card) && move.action !== 'ATTACK') {
    return { valid: false, reason: 'That card can only be used with an attack.' };
  }
  if (move.card === 'Counter' && move.action !== 'DEFEND') {
    return { valid: false, reason: 'Counter can only be used while defending.' };
  }
  return { valid: true };
};

export const hasCapture = (mine: Move, theirs: Move): boolean => {
  const contested = theirs.action === 'ATTACK' && theirs.territory === mine.territory;
  const defended = theirs.action === 'DEFEND' && theirs.territory === mine.territory;
  return mine.action === 'ATTACK' && !contested && (!defended || mine.card === 'Ambush');
};

export const lossFor = (mine: Move, theirs: Move): number => {
  const theyDefendTarget = theirs.action === 'DEFEND' && theirs.territory === mine.territory;
  const theyAttackTarget = theirs.action === 'ATTACK' && theirs.territory === mine.territory;
  if (mine.action === 'ATTACK' && theyDefendTarget) {
    if (mine.card === 'Shield' || mine.card === 'Attack boost') return 0;
    return 1 + (theirs.card === 'Counter' ? 2 : 0);
  }
  if (mine.action === 'ATTACK' && theyAttackTarget) return mine.card === 'Shield' || mine.card === 'Attack boost' ? 0 : 1;
  if (mine.action === 'DEFEND' && theirs.action === 'ATTACK' && theirs.territory === mine.territory) {
    return theirs.card === 'Ambush' ? 3 : theirs.card === 'Shield' ? 0 : 2;
  }
  return 0;
};
