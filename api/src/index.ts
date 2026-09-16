export * from './config.js';
export * from './game.js';
export * from './live.js';

export type ChainMatchStatus = {
  readonly connected: boolean;
  readonly network: string;
  readonly contractAddress?: string;
  readonly phase: string;
  readonly round: number;
  readonly lastReceipt?: import('./live.js').ChainReceipt;
};

export const contractAddressPattern = /^[0-9a-fA-F]{64}$/;

export const isContractAddress = (value: string): boolean => contractAddressPattern.test(value.trim());
