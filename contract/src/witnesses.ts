/*
 * This file defines the shape of ShadowArena's private state, as well as
 * the witness functions that access it.
 *
 * Each player's hidden game state (secret salt, resources, troops, card
 * usage mask and hand of 3 cards) never leaves their machine: it lives in
 * the private state and is bound to the ledger through state commitments
 * proven inside the circuits.
 */

import { Ledger } from "./managed/shadowarena/contract/index.js";
import { WitnessContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";

export type ShadowArenaPrivateState = {
  readonly salt: Uint8Array;
  readonly moveSalt: Uint8Array;
  readonly committedMoveSalt: Uint8Array;
  readonly resources: bigint;
  readonly troops: bigint;
  readonly usedMask: bigint;
  readonly cards: [bigint, bigint, bigint];
};

export const createShadowArenaPrivateState = (
  salt: Uint8Array,
  cards: [bigint, bigint, bigint],
) => ({
  salt,
  moveSalt: randomSalt(),
  committedMoveSalt: randomSalt(),
  resources: 100n, // START_RESOURCES
  troops: 3n, // START_TROOPS
  usedMask: 0n,
  cards,
});

const randomSalt = (): Uint8Array => {
  const salt = new Uint8Array(32);
  globalThis.crypto.getRandomValues(salt);
  return salt;
};

/*
 * The witnesses object for the ShadowArena contract is an object with a
 * field for each witness function declared in the Compact code, mapping the
 * name of the function to its implementation.
 *
 * The implementation of each function always takes as its first argument a
 * value of type WitnessContext<L, PS>; the remaining arguments correspond to
 * the ones declared in Compact.  The return value is a tuple of the (possibly
 * updated) private state and the declared return value.
 */
export const witnesses = {
  mySalt: ({
    privateState,
  }: WitnessContext<Ledger, ShadowArenaPrivateState>): [
    ShadowArenaPrivateState,
    Uint8Array,
  ] => [privateState, privateState.salt],

  myMoveSalt: ({
    privateState,
  }: WitnessContext<Ledger, ShadowArenaPrivateState>): [ShadowArenaPrivateState, Uint8Array] =>
    [privateState, privateState.moveSalt],

  myCommittedMoveSalt: ({
    privateState,
  }: WitnessContext<Ledger, ShadowArenaPrivateState>): [ShadowArenaPrivateState, Uint8Array] =>
    [privateState, privateState.committedMoveSalt],

  rotateMoveSalt: ({
    privateState,
  }: WitnessContext<Ledger, ShadowArenaPrivateState>): [ShadowArenaPrivateState, []] => [
    { ...privateState, committedMoveSalt: privateState.moveSalt, moveSalt: randomSalt() },
    [],
  ],

  myResources: ({
    privateState,
  }: WitnessContext<Ledger, ShadowArenaPrivateState>): [
    ShadowArenaPrivateState,
    bigint,
  ] => [privateState, privateState.resources],

  myTroops: ({
    privateState,
  }: WitnessContext<Ledger, ShadowArenaPrivateState>): [
    ShadowArenaPrivateState,
    bigint,
  ] => [privateState, privateState.troops],

  myUsedMask: ({
    privateState,
  }: WitnessContext<Ledger, ShadowArenaPrivateState>): [
    ShadowArenaPrivateState,
    bigint,
  ] => [privateState, privateState.usedMask],

  myCards: ({
    privateState,
  }: WitnessContext<Ledger, ShadowArenaPrivateState>): [
    ShadowArenaPrivateState,
    [bigint, bigint, bigint],
  ] => [privateState, privateState.cards],

  updatePrivateState: ({
    privateState,
  }: WitnessContext<Ledger, ShadowArenaPrivateState>, resources: bigint, troops: bigint, usedMask: bigint): [
    ShadowArenaPrivateState,
    [],
  ] => [
    { ...privateState, resources, troops, usedMask },
    [],
  ],
};
