import { describe, expect, it } from 'vitest';
import { NETWORKS, resolveNetwork } from './config.js';

describe('Midnight network configuration', () => {
  it('supports every documented network', () => {
    expect(resolveNetwork('mainnet')).toBe('mainnet');
    expect(NETWORKS.mainnet.networkId).toBe('mainnet');
    expect(NETWORKS.preprod.indexer).toContain('indexer.preprod.midnight.network');
  });

  it('rejects misspelled network names instead of silently changing networks', () => {
    expect(() => resolveNetwork('preprod-typo')).toThrow('Unsupported Midnight network');
  });
});
