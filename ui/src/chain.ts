import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { satisfies } from 'semver';
import { fromHex, fromHex as decodeHex, toHex } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { Binding, FinalizedTransaction, Proof, SignatureEnabled, Transaction, TransactionId } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { MidnightProvider, UnboundTransaction, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { PrivateStateExport, SigningKeyExport } from '@midnight-ntwrk/midnight-js-types';
import { NETWORKS, resolveNetwork, ShadowArenaLiveAPI, type ShadowArenaProviders } from '@shadowarena/api';

export type ConnectedWallet = {
  readonly api: ConnectedAPI;
  readonly address: string;
  readonly networkId: keyof typeof NETWORKS;
  readonly providers: ShadowArenaProviders;
  readonly match?: ShadowArenaLiveAPI;
};

export type WalletSession = {
  readonly api: ConnectedAPI;
  readonly address: string;
  readonly networkId: keyof typeof NETWORKS;
  readonly config: Awaited<ReturnType<ConnectedAPI['getConfiguration']>>;
};

export type ShadowArenaBackup = {
  readonly format: 'shadowarena-backup';
  readonly version: 1;
  readonly networkId: keyof typeof NETWORKS;
  readonly contractAddress: string;
  readonly createdAt: string;
  readonly privateStates?: PrivateStateExport;
  readonly signingKeys?: SigningKeyExport;
};

export type WalletOption = {
  readonly id: string;
  readonly rdns: string;
  readonly name: string;
  readonly icon: string;
  readonly apiVersion: string;
};

const walletEntries = (): readonly (readonly [string, InitialAPI])[] => {
  const midnight = (window as Window & { midnight?: Record<string, InitialAPI> }).midnight;
  if (!midnight) return [];
  return Object.entries(midnight).filter(([, wallet]) =>
    !!wallet && typeof wallet === 'object' && satisfies(wallet.apiVersion, '>=4.0.0 <5.0.0'),
  );
};

export const discoverWallets = (): readonly WalletOption[] => walletEntries().map(([id, wallet]) => ({
  id,
  rdns: wallet.rdns,
  name: wallet.name,
  icon: wallet.icon,
  apiVersion: wallet.apiVersion,
}));

const walletFromWindow = (walletId?: string): InitialAPI | undefined => {
  const entries = walletEntries();
  if (walletId) {
    const selected = entries.find(([id, wallet]) => id === walletId || wallet.rdns === walletId || wallet.name === walletId);
    if (selected) return selected[1];
  }
  return entries.find(([id, wallet]) => id === 'mnLace' || wallet.name.toLowerCase().includes('lace'))?.[1] ?? entries[0]?.[1];
};

const walletProvider = (connected: ConnectedAPI): MidnightProvider & WalletProvider => {
  let addresses: Awaited<ReturnType<ConnectedAPI['getShieldedAddresses']>> | undefined;
  return {
    getCoinPublicKey: () => addresses!.shieldedCoinPublicKey,
    getEncryptionPublicKey: () => addresses!.shieldedEncryptionPublicKey,
    balanceTx: async (tx: UnboundTransaction): Promise<FinalizedTransaction> => {
      const received = await connected.balanceUnsealedTransaction(toHex(tx.serialize()));
      return Transaction.deserialize<SignatureEnabled, Proof, Binding>('signature', 'proof', 'binding', fromHex(received.tx));
    },
    submitTx: async (tx: FinalizedTransaction): Promise<TransactionId> => {
      await connected.submitTransaction(toHex(tx.serialize()));
      return tx.identifiers()[0];
    },
    __load: async () => { addresses = await connected.getShieldedAddresses(); },
  } as MidnightProvider & WalletProvider;
};

export const connectToMidnightWallet = async (networkId: string, walletId?: string): Promise<WalletSession> => {
  const selectedNetwork = resolveNetwork(networkId);
  const midnightNetworkId = NETWORKS[selectedNetwork].networkId;
  setNetworkId(midnightNetworkId);
  const initial = walletFromWindow(walletId);
  if (!initial) throw new Error('No compatible Lace or 1AM wallet was detected. Install one of the supported wallets, then try again.');
  const api = await initial.connect(midnightNetworkId);
  const addressResult = await api.getUnshieldedAddress();
  const config = await api.getConfiguration();
  if (config.networkId !== midnightNetworkId) {
    throw new Error(`Wallet connected to ${config.networkId}, but this app is configured for ${midnightNetworkId}. Switch networks in the wallet and reconnect.`);
  }
  return { api, address: addressResult.unshieldedAddress, networkId: selectedNetwork, config };
};

export const initializeMidnightWallet = async (
  session: WalletSession,
  contractAddress?: string,
  cards: [bigint, bigint, bigint] = [3n, 1n, 4n],
  privateStoragePassword?: string,
): Promise<ConnectedWallet> => {
  const { api, address, networkId: selectedNetwork, config } = session;
  const storagePassword = privateStoragePassword?.trim();
  if (!storagePassword || storagePassword.length < 16) {
    throw new Error('A private-state password of at least 16 characters is required. It is never stored by this app; use the same password to reconnect this wallet.');
  }
  const zk = new FetchZkConfigProvider<any>(window.location.origin, fetch.bind(window));
  const provider = walletProvider(api) as any;
  await provider.__load();
  const accountId = address;
  const providers: ShadowArenaProviders = {
    privateStateProvider: levelPrivateStateProvider({
      accountId,
      midnightDbName: 'shadowarena-midnight',
      privateStateStoreName: `shadowarena-private-state-${selectedNetwork}`,
      signingKeyStoreName: `shadowarena-signing-keys-${selectedNetwork}`,
      privateStoragePasswordProvider: () => storagePassword,
    }) as any,
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri, window.WebSocket),
    zkConfigProvider: zk,
    proofProvider: httpClientProofProvider(config.proverServerUri?.trim() || NETWORKS[selectedNetwork].proofServer, zk),
    walletProvider: provider,
    midnightProvider: provider,
  };
  if (contractAddress && !/^[0-9a-fA-F]{64}$/.test(contractAddress)) {
    throw new Error('The configured contract address must be exactly 32 bytes (64 hexadecimal characters).');
  }
  const match = contractAddress
    ? await ShadowArenaLiveAPI.join(providers, contractAddress as ContractAddress, cards)
    : undefined;
  return { api, address, networkId: selectedNetwork, providers, match };
};

export const connectToMidnight = async (
  networkId: string,
  contractAddress?: string,
  cards: [bigint, bigint, bigint] = [3n, 1n, 4n],
  privateStoragePassword?: string,
): Promise<ConnectedWallet> => initializeMidnightWallet(
  await connectToMidnightWallet(networkId),
  contractAddress,
  cards,
  privateStoragePassword,
);

export const deployLiveMatch = async (
  wallet: ConnectedWallet,
  cards: [bigint, bigint, bigint] = [3n, 1n, 4n],
): Promise<ConnectedWallet> => {
  if (wallet.match) return wallet;
  const match = await ShadowArenaLiveAPI.deploy(wallet.providers, cards);
  return { ...wallet, match };
};

export const exportWalletBackup = async (wallet: ConnectedWallet): Promise<ShadowArenaBackup> => {
  if (!wallet.match) throw new Error('Deploy or join a live match before exporting a backup.');
  const provider = wallet.providers.privateStateProvider;
  const contractAddress = String(wallet.match.deployedContractAddress);
  const privateState = await provider.get('shadowArenaPrivateState');
  const signingKey = await provider.getSigningKey(wallet.match.deployedContractAddress);
  if (!privateState && !signingKey) throw new Error('There is no private state or signing key to back up yet. Open the match first.');
  const [privateStates, signingKeys] = await Promise.all([
    privateState ? provider.exportPrivateStates() : Promise.resolve(undefined),
    signingKey ? provider.exportSigningKeys() : Promise.resolve(undefined),
  ]);
  return {
    format: 'shadowarena-backup',
    version: 1,
    networkId: wallet.networkId,
    contractAddress,
    createdAt: new Date().toISOString(),
    privateStates,
    signingKeys,
  };
};

export const importWalletBackup = async (wallet: ConnectedWallet, backup: ShadowArenaBackup): Promise<string> => {
  if (!wallet.match) throw new Error('Deploy or join a live match before restoring a backup.');
  if (backup.format !== 'shadowarena-backup' || backup.version !== 1) throw new Error('Unsupported ShadowArena backup format.');
  if (backup.networkId !== wallet.networkId) throw new Error(`This backup belongs to ${backup.networkId}, not ${wallet.networkId}.`);
  if (backup.contractAddress !== String(wallet.match.deployedContractAddress)) throw new Error('This backup belongs to a different contract address.');
  const provider = wallet.providers.privateStateProvider;
  provider.setContractAddress(wallet.match.deployedContractAddress);
  const importedStates = backup.privateStates
    ? await provider.importPrivateStates(backup.privateStates, { conflictStrategy: 'overwrite' })
    : undefined;
  const importedKeys = backup.signingKeys
    ? await provider.importSigningKeys(backup.signingKeys, { conflictStrategy: 'overwrite' })
    : undefined;
  return `Restored ${importedStates?.imported ?? 0} private state(s) and ${importedKeys?.imported ?? 0} signing key(s).`;
};

export const findWalletInstalled = (): boolean => Boolean(walletFromWindow());
