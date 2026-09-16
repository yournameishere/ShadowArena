import * as ShadowArena from '@shadowarena/contract';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { encodeCoinPublicKey, toHex, type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { map, retry, type Observable } from 'rxjs';
import { CARD_TYPES, type CardType, type Move, type TerritoryOwner } from './game.js';
import type { PlayerSide } from './game.js';

export const shadowArenaPrivateStateKey = 'shadowArenaPrivateState';
export type ShadowArenaProviders = MidnightProviders<any, typeof shadowArenaPrivateStateKey, ShadowArena.ShadowArenaPrivateState>;

export type LiveLedgerSnapshot = {
  readonly status: number;
  readonly round: number;
  readonly territories: readonly TerritoryOwner[];
  readonly playerA?: string;
  readonly playerB?: string;
  readonly stateAOpen: boolean;
  readonly stateBOpen: boolean;
  readonly pendingLossA: number;
  readonly pendingLossB: number;
  readonly winner?: string;
  readonly yourSide?: PlayerSide;
};

export type ChainReceipt = {
  readonly txId: string;
  readonly txHash?: string;
  readonly blockHash?: string;
  readonly blockHeight?: number;
  readonly status: string;
};

const ownerName = (owner: unknown): TerritoryOwner => {
  const value = String(owner);
  if (value.endsWith('A') || value === '1') return 'A';
  if (value.endsWith('B') || value === '2') return 'B';
  return 'neutral';
};

const publicKeyString = (value: unknown): string => value instanceof Uint8Array ? toHex(value) : String(value);

export const toLedgerSnapshot = (ledger: any): LiveLedgerSnapshot => {
  const territories: TerritoryOwner[] = Array.from({ length: 15 }, (_, id) => ownerName(ledger.territories.lookup(BigInt(id))));
  return {
    status: Number(ledger.status),
    round: Number(ledger.round),
    territories,
    playerA: ledger.playerA?.is_some ? publicKeyString(ledger.playerA.value) : undefined,
    playerB: ledger.playerB?.is_some ? publicKeyString(ledger.playerB.value) : undefined,
    stateAOpen: Boolean(ledger.stateA?.is_some),
    stateBOpen: Boolean(ledger.stateB?.is_some),
    pendingLossA: Number(ledger.pendingLossA),
    pendingLossB: Number(ledger.pendingLossB),
    winner: ledger.winner?.is_some ? publicKeyString(ledger.winner.value) : undefined,
  };
};

const sideFor = (snapshot: LiveLedgerSnapshot, coinPublicKey: unknown): PlayerSide | undefined => {
  const encoded = publicKeyString(encodeCoinPublicKey(coinPublicKey as any));
  if (snapshot.playerA === encoded) return 'A';
  if (snapshot.playerB === encoded) return 'B';
  return undefined;
};

const keyString = (coinPublicKey: unknown): string => publicKeyString(encodeCoinPublicKey(coinPublicKey as any));

const cardValue = (card?: CardType): any => {
  if (!card) return { is_some: false, value: 0n };
  return { is_some: true, value: BigInt(CARD_TYPES.indexOf(card)) };
};

const actionValue = (action: Move['action']): any => ({ RECON: 0n, ATTACK: 1n, DEFEND: 2n, BUILD: 3n, PASS: 4n })[action];
const randomSalt = (): Uint8Array => {
  const salt = new Uint8Array(32);
  globalThis.crypto.getRandomValues(salt);
  return salt;
};

const receiptOf = (result: any): ChainReceipt => ({
  txId: String(result.public.txId),
  txHash: result.public.txHash ? String(result.public.txHash) : undefined,
  blockHash: result.public.blockHash ? String(result.public.blockHash) : undefined,
  blockHeight: typeof result.public.blockHeight === 'number' ? result.public.blockHeight : undefined,
  status: String(result.public.status?.status ?? result.public.status ?? 'submitted'),
});

export class ShadowArenaLiveAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<LiveLedgerSnapshot>;
  readonly history$: Observable<LiveLedgerSnapshot>;

  private constructor(
    private readonly deployed: any,
    private readonly providers: ShadowArenaProviders,
  ) {
    this.deployedContractAddress = deployed.deployTxData.public.contractAddress;
    providers.privateStateProvider.setContractAddress(this.deployedContractAddress);
    const snapshots = (config: { readonly type: 'latest' } | { readonly type: 'all' }) => providers.publicDataProvider
      .contractStateObservable(this.deployedContractAddress, config)
      .pipe(retry({ count: 5, delay: 1_000 }), map((state: any) => {
        const snapshot = toLedgerSnapshot(ShadowArena.ledger(state.data));
        return { ...snapshot, yourSide: sideFor(snapshot, providers.walletProvider.getCoinPublicKey()) };
      }));
    this.state$ = snapshots({ type: 'latest' });
    this.history$ = snapshots({ type: 'all' });
  }

  async getPrivateState(): Promise<ShadowArena.ShadowArenaPrivateState | null> {
    return this.providers.privateStateProvider.get(shadowArenaPrivateStateKey);
  }

  async openState(): Promise<ChainReceipt> {
    return receiptOf(await this.deployed.callTx.openState());
  }

  async createMatch(opponent: Uint8Array): Promise<ChainReceipt> {
    return receiptOf(await this.deployed.callTx.createMatch(opponent));
  }

  async submitCommit(move: Move): Promise<ChainReceipt> {
    return receiptOf(await this.deployed.callTx.submitCommit(
      actionValue(move.action),
      BigInt(move.origin),
      BigInt(move.territory),
      BigInt(move.troops),
      cardValue(move.card),
    ));
  }

  async revealMove(move: Move): Promise<ChainReceipt> {
    return receiptOf(await this.deployed.callTx.revealMove(
      actionValue(move.action),
      BigInt(move.origin),
      BigInt(move.territory),
      BigInt(move.troops),
      cardValue(move.card),
    ));
  }

  async settle(): Promise<ChainReceipt> {
    return receiptOf(await this.deployed.callTx.settle());
  }

  async forfeit(): Promise<ChainReceipt> {
    return receiptOf(await this.deployed.callTx.forfeit());
  }

  static async deploy(providers: ShadowArenaProviders, cards: [bigint, bigint, bigint]): Promise<ShadowArenaLiveAPI> {
    const deployed = await deployContract(providers as any, {
      compiledContract: ShadowArena.ShadowArenaContract,
      privateStateId: shadowArenaPrivateStateKey,
      initialPrivateState: ShadowArena.createShadowArenaPrivateState(randomSalt(), cards),
    });
    return new ShadowArenaLiveAPI(deployed, providers);
  }

  static async join(providers: ShadowArenaProviders, address: ContractAddress, cards: [bigint, bigint, bigint]): Promise<ShadowArenaLiveAPI> {
    providers.privateStateProvider.setContractAddress(address);
    const existing = await providers.privateStateProvider.get(shadowArenaPrivateStateKey);
    const publicState = await providers.publicDataProvider.queryContractState(address);
    if (!publicState) throw new Error('The configured contract address was not found on the selected Midnight network.');
    const snapshot = toLedgerSnapshot(ShadowArena.ledger(publicState.data));
    const ownKey = keyString(providers.walletProvider.getCoinPublicKey());
    const side = snapshot.playerA === ownKey ? 'A' : snapshot.playerB === ownKey ? 'B' : undefined;
    if (snapshot.status !== 0 && !side) {
      throw new Error('This wallet is not one of the players in the configured match.');
    }
    const stateAlreadyOpened = side === 'A' ? snapshot.stateAOpen : side === 'B' ? snapshot.stateBOpen : false;
    if (!existing && stateAlreadyOpened) {
      throw new Error('Private state for this wallet and match is missing. Restore your encrypted provider backup before reconnecting.');
    }
    const deployed = await findDeployedContract(providers as any, {
      contractAddress: address,
      compiledContract: ShadowArena.ShadowArenaContract,
      privateStateId: shadowArenaPrivateStateKey,
      initialPrivateState: existing ?? ShadowArena.createShadowArenaPrivateState(randomSalt(), cards),
    });
    return new ShadowArenaLiveAPI(deployed, providers);
  }
}

export * from './game.js';
