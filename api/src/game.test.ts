import { describe, expect, it } from 'vitest';
import { cardCost, hasCapture, isAdjacent, lossFor, validateMove } from './game.js';

const board = ['A', 'neutral', 'B', 'neutral', 'neutral', 'A', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'B'] as const;

describe('ShadowArena rules', () => {
  it('understands the 3 x 5 board adjacency', () => {
    expect(isAdjacent(0, 1)).toBe(true);
    expect(isAdjacent(0, 5)).toBe(true);
    expect(isAdjacent(4, 5)).toBe(false);
  });

  it('charges the correct action cost', () => {
    expect(cardCost('ATTACK')).toBe(10);
    expect(cardCost('ATTACK', 'Spy')).toBe(0);
    expect(cardCost('BUILD')).toBe(15);
  });

  it('rejects an attack from an unowned origin', () => {
    const result = validateMove({ action: 'ATTACK', origin: 2, territory: 3, troops: 2 }, 'A', board, 100, 3, []);
    expect(result).toEqual({ valid: false, reason: 'The origin must be one of your territories.' });
  });

  it('accepts a legal adjacent attack', () => {
    expect(validateMove({ action: 'ATTACK', origin: 0, territory: 1, troops: 2 }, 'A', board, 100, 3, [])).toEqual({ valid: true });
  });

  it('rejects cards used with the wrong action', () => {
    expect(validateMove({ action: 'DEFEND', origin: 0, territory: 0, troops: 0, card: 'Ambush' }, 'A', board, 100, 3, ['Ambush'])).toEqual({
      valid: false,
      reason: 'That card can only be used with an attack.',
    });
    expect(validateMove({ action: 'ATTACK', origin: 0, territory: 1, troops: 2, card: 'Counter' }, 'A', board, 100, 3, ['Counter'])).toEqual({
      valid: false,
      reason: 'Counter can only be used while defending.',
    });
  });

  it('applies ambush and counter losses', () => {
    const attack = { action: 'ATTACK' as const, origin: 0, territory: 1, troops: 2, card: 'Ambush' as const };
    const defend = { action: 'DEFEND' as const, origin: 14, territory: 1, troops: 0, card: 'Counter' as const };
    expect(hasCapture(attack, defend)).toBe(true);
    expect(lossFor(attack, defend)).toBe(1 + 2);
  });
});
