export type MidnightNetwork = 'local' | 'preview' | 'preprod' | 'mainnet';

export type NetworkConfig = {
  readonly networkId: 'undeployed' | 'preview' | 'preprod' | 'mainnet';
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly nodeWS: string;
  readonly proofServer: string;
  readonly faucet: string;
};

export const NETWORKS: Record<MidnightNetwork, NetworkConfig> = {
  local: {
    networkId: 'undeployed',
    indexer: 'http://127.0.0.1:8088/api/v4/graphql',
    indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
    node: 'http://127.0.0.1:9944',
    nodeWS: 'ws://127.0.0.1:9944',
    proofServer: 'http://127.0.0.1:6300',
    faucet: '',
  },
  preview: {
    networkId: 'preview',
    indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    node: 'https://rpc.preview.midnight.network',
    nodeWS: 'wss://rpc.preview.midnight.network',
    proofServer: 'http://127.0.0.1:6300',
    faucet: 'https://midnight-tmnight-preview.nethermind.dev/',
  },
  preprod: {
    networkId: 'preprod',
    indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    node: 'https://rpc.preprod.midnight.network',
    nodeWS: 'wss://rpc.preprod.midnight.network',
    proofServer: 'http://127.0.0.1:6300',
    faucet: 'https://midnight-tmnight-preprod.nethermind.dev/',
  },
  mainnet: {
    networkId: 'mainnet',
    indexer: 'https://indexer.mainnet.midnight.network/api/v4/graphql',
    indexerWS: 'wss://indexer.mainnet.midnight.network/api/v4/graphql/ws',
    node: 'https://rpc.mainnet.midnight.network',
    nodeWS: 'wss://rpc.mainnet.midnight.network',
    proofServer: 'http://127.0.0.1:6300',
    faucet: '',
  },
};

export const resolveNetwork = (value?: string): MidnightNetwork => {
  if (value === undefined || value === '') return 'preprod';
  if (value === 'local' || value === 'preview' || value === 'preprod' || value === 'mainnet') return value;
  throw new Error(`Unsupported Midnight network "${value}". Use local, preview, preprod, or mainnet.`);
};
