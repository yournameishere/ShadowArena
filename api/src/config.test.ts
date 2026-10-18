import { describe, expect, it } from 'vitest';
import { NETWORKS, explorerTxUrl, resolveNetwork } from './config.js';

describe('Midnight network configuration', () => {
  it('supports every documented network', () => {
    expect(resolveNetwork('mainnet')).toBe('mainnet');
    expect(NETWORKS.mainnet.networkId).toBe('mainnet');
    expect(NETWORKS.preprod.indexer).toContain('indexer.preprod.midnight.network');
  });

  it('exposes an explorer for public transaction review', () => {
    expect(explorerTxUrl('preprod', 'abc')).toBe('https://preprod.midnightexplorer.com/transactions/0xabc');
    expect(explorerTxUrl('preprod', '0xabc')).toBe('https://preprod.midnightexplorer.com/transactions/0xabc');
    expect(explorerTxUrl('local', 'abc')).toBeUndefined();
    expect(explorerTxUrl('preprod')).toBeUndefined();
  });

  it('rejects misspelled network names instead of silently changing networks', () => {
    expect(() => resolveNetwork('preprod-typo')).toThrow('Unsupported Midnight network');
  });
});
