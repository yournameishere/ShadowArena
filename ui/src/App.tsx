import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  CARD_TYPES,
  territoryName,
  validateMove,
  type Action,
  type CardType,
  type Move,
  type PlayerSide,
} from '@shadowarena/api/game';
import { explorerTxUrl } from '@shadowarena/api/config';
import type { ShadowArenaPrivateState } from '@shadowarena/contract';
import { fromHex } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { ConnectedWallet, ShadowArenaBackup, WalletOption } from './chain';
import { ShadowArenaSimulator, actionLabel, type SimulationState } from './simulator';
import { applyLiveSnapshot } from './live-state';
import './styles.css';

const networkId = import.meta.env.VITE_NETWORK_ID ?? 'preprod';
const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS ?? '';
const configuredOpponent = import.meta.env.VITE_OPPONENT_PUBLIC_KEY ?? '';
const actions: Action[] = ['RECON', 'ATTACK', 'DEFEND', 'BUILD', 'PASS'];
const MIN_BACKUP_PASSWORD = 16;

const shorten = (value: string): string => value.length < 18 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;

const copyText = async (value: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const input = document.createElement('textarea');
      input.value = value;
      input.setAttribute('readonly', 'true');
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      return true;
    } catch {
      return false;
    }
  }
};

type MatchEntry = { readonly address: string; readonly role: 'host' | 'guest'; readonly updatedAt: string };

const registryKey = (network: string): string => `shadowarena-registry-${network}`;

const loadRegistry = (network: string): readonly MatchEntry[] => {
  try {
    const raw = window.localStorage.getItem(registryKey(network));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is MatchEntry =>
      !!entry && typeof entry === 'object'
      && typeof (entry as MatchEntry).address === 'string'
      && /^[0-9a-fA-F]{64}$/.test((entry as MatchEntry).address),
    );
  } catch { return []; }
};

const rememberMatch = (network: string, address: string, role: MatchEntry['role']): readonly MatchEntry[] => {
  let entries: readonly MatchEntry[] = [];
  try {
    entries = loadRegistry(network).filter((entry) => entry.address.toLowerCase() !== address.toLowerCase());
    const next: MatchEntry[] = [{ address, role, updatedAt: new Date().toISOString() }, ...entries].slice(0, 8);
    window.localStorage.setItem(registryKey(network), JSON.stringify(next));
    return next;
  } catch {
    return entries;
  }
};

const forgetMatch = (network: string, address: string): readonly MatchEntry[] => {
  const next = loadRegistry(network).filter((entry) => entry.address.toLowerCase() !== address.toLowerCase());
  try { window.localStorage.setItem(registryKey(network), JSON.stringify(next)); } catch { /* storage unavailable */ }
  return next;
};

const parseBackup = (value: unknown): ShadowArenaBackup => {
  if (!value || typeof value !== 'object') throw new Error('The selected file is not a ShadowArena backup.');
  const backup = value as Partial<ShadowArenaBackup>;
  if (backup.format !== 'shadowarena-backup' || backup.version !== 1 || typeof backup.networkId !== 'string' || typeof backup.contractAddress !== 'string') {
    throw new Error('The selected file is not a supported ShadowArena backup.');
  }
  return backup as ShadowArenaBackup;
};

const privateStateView = (privateState: ShadowArenaPrivateState) => {
  const hand = privateState.cards
    .map((value) => CARD_TYPES[Number(value)])
    .filter((value): value is CardType => Boolean(value));
  const usedCards = hand.filter((_, index) => (privateState.usedMask & (1n << BigInt(index))) !== 0n);
  return { hand, usedCards, resources: Number(privateState.resources), troops: Number(privateState.troops) };
};

const browserUnlockKey = (network: string, address: string): string => {
  const storageKey = `shadowarena-unlock-${network}-${address}`;
  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing) return existing;
  } catch {
    // Private browsing modes can deny localStorage; the generated key still
    // protects this session, while backup remains available after connecting.
  }
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  const generated = window.btoa(String.fromCharCode(...bytes));
  try { window.localStorage.setItem(storageKey, generated); } catch { /* session-only fallback */ }
  return generated;
};

const promptBackupPassword = (creating: boolean): string | undefined => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const value = window.prompt(creating
      ? `Create a backup password (${MIN_BACKUP_PASSWORD}+ characters). Keep it separate from the downloaded JSON.`
      : `Enter the backup password (${MIN_BACKUP_PASSWORD}+ characters) used during export.`);
    if (!value) return undefined;
    if (value.trim().length >= MIN_BACKUP_PASSWORD) return value;
    window.alert(`The backup password must be at least ${MIN_BACKUP_PASSWORD} characters.`);
  }
  return undefined;
};

export default function App() {
  const simulator = useRef(new ShadowArenaSimulator());
  const [state, setState] = useState<SimulationState>(simulator.current.state);
  const [action, setAction] = useState<Action>('ATTACK');
  const [origin, setOrigin] = useState(0);
  const [target, setTarget] = useState(1);
  const [troops, setTroops] = useState(2);
  const [card, setCard] = useState<CardType | undefined>();
  const [wallet, setWallet] = useState<ConnectedWallet | undefined>();
  const [walletOptions, setWalletOptions] = useState<readonly WalletOption[]>([]);
  const [walletBusy, setWalletBusy] = useState(false);
  const [txBusy, setTxBusy] = useState(false);
  const [playerSide, setPlayerSide] = useState<PlayerSide>('A');
  const [lastReceipt, setLastReceipt] = useState<string | undefined>();
  const [lastAction, setLastAction] = useState<string | undefined>();
  const [opponentKey, setOpponentKey] = useState(configuredOpponent);
  const [joinAddress, setJoinAddress] = useState(contractAddress);
  const [joinBusy, setJoinBusy] = useState(false);
  const [matchRegistry, setMatchRegistry] = useState<readonly MatchEntry[]>(() => loadRegistry(networkId));
  const [liveCommittedMove, setLiveCommittedMove] = useState<Move | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [activePanel, setActivePanel] = useState<'battle' | 'rules'>('battle');
  const backupInput = useRef<HTMLInputElement>(null);

  const isLive = Boolean(wallet?.match);
  const needsPrivateOpen = Boolean(wallet?.match && state.phase !== 'CREATED' && state.phase !== 'COMPLETE' && !state.publicStateOpen);
  const availableCards = useMemo(() => state.hand.filter((item) => !state.usedCards.includes(item)), [state.hand, state.usedCards]);
  const move: Move = { action, origin, territory: target, troops: action === 'ATTACK' ? troops : 0, card };
  const activeNetwork = wallet?.networkId ?? networkId;
  const matchAddress = isLive && wallet?.match ? String(wallet.match.deployedContractAddress) : undefined;
  const maxTroops = Math.min(9, Math.max(2, state.troops));
  const gameOver = state.phase === 'COMPLETE';
  const youWonLive = isLive && gameOver && state.winner === playerSide;

  useEffect(() => {
    const syncPanelFromHash = () => setActivePanel(window.location.hash === '#rules' ? 'rules' : 'battle');
    syncPanelFromHash();
    window.addEventListener('hashchange', syncPanelFromHash);
    return () => window.removeEventListener('hashchange', syncPanelFromHash);
  }, []);

  useEffect(() => {
    if (!wallet?.match) return;
    const subscription = wallet.match.history$.subscribe((snapshot) => {
      setState((previous) => applyLiveSnapshot(previous, snapshot));
      if (snapshot.yourSide) setPlayerSide(snapshot.yourSide);
      if (snapshot.status === 3) clearLivePendingReveal();
    }, (error) => setNotice(error instanceof Error ? `Indexer sync failed: ${error.message}` : 'Indexer sync failed. Reconnect to retry.'));
    return () => subscription.unsubscribe();
  }, [wallet]);

  useEffect(() => {
    const firstOwned = state.board.findIndex((owner) => owner === playerSide);
    if (firstOwned >= 0 && state.board[origin] !== playerSide) setOrigin(firstOwned);
  }, [playerSide, state.board, origin]);

  useEffect(() => {
    if (card && state.usedCards.includes(card)) setCard(undefined);
  }, [card, state.usedCards]);

  useEffect(() => {
    if (!wallet?.match) return;
    void wallet.match.getPrivateState().then((privateState) => {
      if (!privateState) return;
      const view = privateStateView(privateState);
      setState((previous) => ({ ...previous, ...view }));
    }).catch((error) => setNotice(error instanceof Error ? `Private state could not be loaded: ${error.message}` : 'Private state could not be loaded.'));
  }, [wallet]);

  // Restore a committed-but-unrevealed move after a reload so that the
  // reveal always matches the on-chain commitment.
  useEffect(() => {
    if (!wallet?.match) return;
    const key = `shadowarena-pending-reveal-${wallet.networkId}-${String(wallet.match.deployedContractAddress)}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Move> | null;
      if (parsed && typeof parsed === 'object' && typeof parsed.action === 'string' && typeof parsed.origin === 'number' && typeof parsed.territory === 'number') {
        setLiveCommittedMove({
          action: parsed.action as Action,
          origin: parsed.origin,
          territory: parsed.territory,
          troops: typeof parsed.troops === 'number' ? parsed.troops : 0,
          card: parsed.card as CardType | undefined,
        });
      }
    } catch { /* corrupted storage — ignore */ }
  }, [wallet]);

  const changeAction = (next: Action) => {
    setAction(next);
    // Keep the selection legal when the action changes shape.
    if (next === 'DEFEND' || next === 'BUILD') {
      if (state.board[target] !== playerSide) setTarget(origin);
    } else if (next === 'ATTACK' || next === 'RECON') {
      if (target === origin || state.board[target] === playerSide) {
        const attackable = state.board.findIndex((owner, id) => id !== origin && owner !== playerSide);
        if (attackable >= 0) setTarget(attackable);
      }
    }
  };

  const selectTerritory = (id: number) => {
    setTarget(id);
  };

  // Share the same rules the contract enforces, so an illegal live move is
  // caught before a transaction is paid for.
  const preflightReason = (next: Move): string | undefined => {
    if (!isLive) return undefined;
    const result = validateMove(next, playerSide, state.board, state.resources, state.troops, state.hand, state.usedCards);
    return result.valid ? undefined : result.reason;
  };

  const rememberLiveMatch = (address: string, role: MatchEntry['role']) => {
    setMatchRegistry(rememberMatch(activeNetwork, address, role));
  };

  const commit = async () => {
    if (txBusy) return;
    if (isLive && wallet?.match) {
      const invalid = preflightReason(move);
      if (invalid) { setNotice(invalid); return; }
      setTxBusy(true);
      setNotice(`Submitting a private commitment to ${activeNetwork}…`);
      try {
        const receipt = await wallet.match.submitCommit(move);
        setLastReceipt(receipt.txId);
        setLastAction(`${actionLabel[action]} commitment`);
        setLiveCommittedMove(move);
        savePendingReveal(move);
        setState((previous) => ({ ...previous, events: [`Commitment sealed on-chain · ${shorten(receipt.txId)}`, ...previous.events] }));
        const privateState = await wallet.match.getPrivateState();
        if (privateState) setState((previous) => ({ ...previous, ...privateStateView(privateState) }));
        setNotice(`Commitment sealed on ${activeNetwork}. Reveal it when the match reaches the reveal phase.`);
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Commitment failed.'); }
      finally { setTxBusy(false); }
      return;
    }
    setState(simulator.current.commit(move));
  };

  const reveal = async () => {
    if (txBusy) return;
    if (isLive && wallet?.match) {
      const pendingMove = liveCommittedMove ?? move;
      const invalid = preflightReason(pendingMove);
      if (invalid) { setNotice(invalid); return; }
      setTxBusy(true);
      setNotice('Generating proof and revealing the move…');
      try {
        const receipt = await wallet.match.revealMove(pendingMove);
        setLastReceipt(receipt.txId);
        setLastAction(`${actionLabel[pendingMove.action]} revealed`);
        clearLivePendingReveal();
        setState((previous) => ({ ...previous, events: ['Move revealed and proven on-chain', ...previous.events] }));
        const privateState = await wallet.match.getPrivateState();
        if (privateState) setState((previous) => ({ ...previous, ...privateStateView(privateState) }));
        setNotice(`Move revealed on ${activeNetwork}. Transaction ${shorten(receipt.txId)}.`);
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Reveal failed.'); }
      finally { setTxBusy(false); }
      return;
    }
    setState(simulator.current.reveal());
  };

  const settle = async () => {
    if (txBusy) return;
    if (isLive && wallet?.match) {
      setTxBusy(true);
      setNotice('Settling private troop losses…');
      try {
        const receipt = await wallet.match.settle();
        setLastReceipt(receipt.txId);
        setLastAction('Loss settlement');
        setState((previous) => ({ ...previous, events: ['Private losses settled on-chain', ...previous.events] }));
        const privateState = await wallet.match.getPrivateState();
        if (privateState) setState((previous) => ({ ...previous, ...privateStateView(privateState) }));
        setNotice(`Private losses settled on ${activeNetwork}. Transaction ${shorten(receipt.txId)}.`);
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Settlement failed.'); }
      finally { setTxBusy(false); }
      return;
    }
    setState(simulator.current.settle());
  };

  const forfeit = async () => {
    if (!wallet?.match || txBusy || state.phase === 'CREATED' || state.phase === 'COMPLETE') return;
    if (!window.confirm('Forfeit this live match? The opponent will be recorded as the winner.')) return;
    setTxBusy(true);
    setNotice('Submitting the forfeit transaction…');
    try {
      const receipt = await wallet.match.forfeit();
      setLastReceipt(receipt.txId);
      setLastAction('Forfeit');
      setState((previous) => ({ ...previous, phase: 'COMPLETE', message: 'You forfeited the live match. The opponent is recorded as the winner.' }));
      setNotice(`Match forfeited on ${activeNetwork}. Transaction ${shorten(receipt.txId)}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Forfeit failed.'); }
    finally { setTxBusy(false); }
  };

  const reset = () => {
    if (isLive) return;
    setLastReceipt(undefined);
    setLastAction(undefined);
    setPlayerSide('A');
    setAction('ATTACK');
    setOrigin(0);
    setTarget(1);
    setTroops(2);
    setCard(undefined);
    setState(simulator.current.reset());
  };

  const pendingRevealKey = (network: string, address: string): string => `shadowarena-pending-reveal-${network}-${address}`;

  const savePendingReveal = (next: Move): void => {
    if (!matchAddress) return;
    try { window.localStorage.setItem(pendingRevealKey(activeNetwork, matchAddress), JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  const clearLivePendingReveal = (): void => {
    setLiveCommittedMove(undefined);
    if (!matchAddress) return;
    try { window.localStorage.removeItem(pendingRevealKey(activeNetwork, matchAddress)); } catch { /* storage unavailable */ }
  };

  const copyAddress = async (value: string) => {
    const copied = await copyText(value);
    setNotice(copied ? 'Contract address copied. Share it with your opponent so they can join the match.' : 'Copy failed. Select the address text manually.');
  };

  const connectWithWallet = async (walletId?: string) => {
    setWalletBusy(true);
    setNotice(undefined);
    try {
      const { connectToMidnightWallet, discoverWallets, initializeMidnightWallet } = await import('./chain.js');
      const available = discoverWallets();
      if (!available.length) throw new Error('Install Lace or 1AM, then refresh this page to connect a Midnight wallet.');
      if (!walletId && available.length > 1) {
        setWalletOptions(available);
        setNotice('Choose a wallet to continue.');
        return;
      }
      const session = await connectToMidnightWallet(networkId, walletId ?? available[0].id);
      setWalletOptions([]);
      setNotice('Wallet connected. Preparing your encrypted private state…');
      const connected = await initializeMidnightWallet(session, contractAddress || undefined, [3n, 1n, 4n], browserUnlockKey(session.networkId, session.address));
      setWallet(connected);
      setNotice(connected.match ? 'Connected to the live match.' : 'Wallet ready. Deploy or join a contract below to start a live match.');
      setJoinAddress(connected.match ? String(connected.match.deployedContractAddress) : contractAddress);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Wallet connection failed.');
    } finally { setWalletBusy(false); }
  };

  const connect = () => void connectWithWallet();

  const deploy = async (forceNew = false) => {
    if (!wallet || txBusy) return;
    setTxBusy(true);
    setNotice(`Deploying the ShadowArena contract to ${activeNetwork}…`);
    try {
      const { deployLiveMatch } = await import('./chain.js');
      const deployed = await deployLiveMatch(wallet, [3n, 1n, 4n], { forceNew });
      setWallet(deployed);
      if (deployed.match) {
        const address = String(deployed.match.deployedContractAddress);
        rememberLiveMatch(address, 'host');
        setJoinAddress(address);
        setNotice(`Contract deployed. Address copied to your clipboard — share it with your opponent so they can join from this page via “Join with address”.`);
        void copyText(address);
      } else {
        setNotice('Deployment finished, but no live match handle was returned.');
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Contract deployment failed.'); }
    finally { setTxBusy(false); }
  };

  const joinWithAddress = async (addressInput?: string) => {
    if (!wallet || txBusy || joinBusy) return;
    const normalized = (addressInput ?? joinAddress).trim().replace(/^0x/, '');
    if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
      setNotice('A contract address is exactly 32 bytes — paste the 64 hex characters your opponent shared.');
      return;
    }
    setJoinBusy(true);
    setNotice(`Joining the live match on ${activeNetwork}…`);
    try {
      const { joinLiveMatch } = await import('./chain.js');
      const joined = await joinLiveMatch(wallet, normalized);
      setWallet(joined);
      rememberLiveMatch(normalized, 'guest');
      setJoinAddress(normalized);
      setNotice(joined.match ? `Joined ${shorten(normalized)}. Waiting for the public match state to sync…` : 'The address could not be opened as a ShadowArena match.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Joining the match failed.'); }
    finally { setJoinBusy(false); }
  };

  const createAndOpen = async () => {
    if (!wallet?.match || txBusy) return;
    const normalized = opponentKey.trim().replace(/^0x/, '');
    if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
      setNotice('Enter the opponent coin public key as exactly 32 bytes (64 hex characters).');
      return;
    }
    setTxBusy(true);
    setNotice(`Creating the match and opening your private state on ${activeNetwork}…`);
    try {
      const created = await wallet.match.createMatch(fromHex(normalized));
      setLastReceipt(created.txId);
      setLastAction('Match creation');
      const opened = await wallet.match.openState();
      setLastReceipt(opened.txId);
      rememberLiveMatch(matchAddress ?? '', 'host');
      setState((previous) => ({ ...previous, phase: 'COMMIT_PHASE', publicStateOpen: true, message: 'Match created. Waiting for the opponent to open private state.', events: ['Match created · private state opened', ...previous.events] }));
      setNotice(`Match created on ${activeNetwork}. Share contract ${shorten(String(wallet.match.deployedContractAddress))} with your opponent.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Match creation failed.'); }
    finally { setTxBusy(false); }
  };

  const openLiveState = async () => {
    if (!wallet?.match || txBusy) return;
    setTxBusy(true);
    setNotice(`Opening your private state on ${activeNetwork}…`);
    try {
      const receipt = await wallet.match.openState();
      setLastReceipt(receipt.txId);
      setLastAction('State opening');
      const privateState = await wallet.match.getPrivateState();
      if (privateState) setState((previous) => ({ ...previous, publicStateOpen: true, ...privateStateView(privateState), events: ['Your private state is bound to the ledger', ...previous.events] }));
      else setState((previous) => ({ ...previous, publicStateOpen: true }));
      setNotice(`Private state opened on ${activeNetwork}. Transaction ${shorten(receipt.txId)}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Opening private state failed.'); }
    finally { setTxBusy(false); }
  };

  const downloadBackup = async () => {
    if (!wallet || !wallet.match || txBusy) return;
    const backupPassword = promptBackupPassword(true);
    if (!backupPassword) return;
    setTxBusy(true);
    setNotice('Preparing an encrypted private-state backup…');
    try {
      const { exportWalletBackup } = await import('./chain.js');
      const backup = await exportWalletBackup(wallet, backupPassword);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `shadowarena-${wallet.networkId}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice('Encrypted backup downloaded. Store it separately from this browser profile.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Backup export failed.'); }
    finally { setTxBusy(false); }
  };

  const restoreBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !wallet || !wallet.match || txBusy) return;
    try { parseBackup(JSON.parse(await file.text())); } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The selected file is not a supported ShadowArena backup.');
      return;
    }
    if (!window.confirm('Restore this backup and overwrite matching local state for this contract?')) return;
    const backupPassword = promptBackupPassword(false);
    if (!backupPassword) return;
    setTxBusy(true);
    setNotice('Restoring the encrypted private state…');
    try {
      const backup = parseBackup(JSON.parse(await file.text()));
      const { importWalletBackup } = await import('./chain.js');
      const result = await importWalletBackup(wallet, backup, backupPassword);
      const privateState = await wallet.match.getPrivateState();
      if (privateState) setState((previous) => ({ ...previous, ...privateStateView(privateState) }));
      setNotice(result);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Backup restore failed.'); }
    finally { setTxBusy(false); }
  };

  const phaseLabel = state.phase === 'COMMIT_PHASE' ? 'Commit phase' : state.phase === 'REVEAL_PHASE' ? 'Reveal phase' : state.phase === 'COMPLETE' ? 'Complete' : 'Created';

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="ShadowArena home"><span className="brand-mark">◒</span><span>Shadow<span className="brand-accent">Arena</span></span></a>
        <nav className="topnav" aria-label="Primary navigation">
          <button className={activePanel === 'battle' ? 'nav-link active' : 'nav-link'} onClick={() => { setActivePanel('battle'); window.location.hash = 'main'; }}>Battle room</button>
          <button className={activePanel === 'rules' ? 'nav-link active' : 'nav-link'} onClick={() => { setActivePanel('rules'); window.location.hash = 'rules'; }}>How it works</button>
        </nav>
        <div className="top-actions">
          <span className="network-pill"><span className="status-dot" />{activeNetwork}</span>
          {matchAddress ? <button className="wallet-button address-chip" onClick={() => void copyAddress(matchAddress)} aria-label="Copy contract address" title={`Copy contract address ${matchAddress}`}><span className="status-dot pulse" />{txBusy ? 'Working…' : shorten(matchAddress)}<small className="chip-copy">copy</small></button> : wallet ? <button className="wallet-button" onClick={() => void deploy()} disabled={txBusy}>{txBusy ? 'Deploying…' : 'Deploy contract'}</button> : <button className="wallet-button" onClick={connect} disabled={walletBusy}>{walletBusy ? 'Connecting…' : 'Connect Lace / 1AM'}</button>}
        </div>
      </header>

      <main id="main" className="content">
        {activePanel === 'rules' ? <RulesPanel onBack={() => { setActivePanel('battle'); window.location.hash = 'main'; }} /> : (
          <>
            <section className="hero-row">
              <div>
                <p className="eyebrow">Private strategy / {isLive ? 'live match' : 'rehearsal'}</p>
                <h1>Read the board.<br /><em>Keep the edge.</em></h1>
                <p className="hero-copy">Make a move your opponent cannot see. Midnight verifies the rules without exposing your hand, resources, or plan.</p>
              </div>
              <div className="hero-meta">
                <span className="live-indicator"><span className="pulse" />{isLive ? 'Live on chain' : 'Rehearsal mode'}</span>
                <span className="mono">ROUND {String(state.round).padStart(2, '0')}</span>
              </div>
            </section>

            {notice && <div className="notice" role="status"><span className="notice-glyph">✦</span><span>{notice}</span>{notice.startsWith('Indexer sync failed') && <button className="notice-reconnect" onClick={() => window.location.reload()}>Reconnect</button>}<button onClick={() => setNotice(undefined)} aria-label="Dismiss notification">×</button></div>}

            <section className="battle-grid">
              <div className="board-card panel">
                <div className="panel-head"><div><p className="eyebrow">Tactical field</p><h2>Territories</h2></div><span className="panel-caption"><span className="key-dot you" /> You · Player {playerSide} <span className="key-dot enemy" /> Opponent</span></div>
                <div className="board-wrap">
                  <div className="board-lines" aria-hidden="true" />
                  <div className="board" aria-label="Tactical territory board">
                    {state.board.map((owner, id) => {
                      const isSelected = id === target || id === origin;
                      const selectable = state.phase === 'COMMIT_PHASE' && !txBusy;
                      const isMine = owner === playerSide;
                      return <button key={id} className={`territory ${owner.toLowerCase()} ${isSelected ? 'selected' : ''} ${id === 0 || id === 14 ? 'base' : ''}`} onClick={() => selectable && selectTerritory(id)} disabled={!selectable} aria-pressed={isSelected} aria-label={`${territoryName(id)} territory, ${owner === 'neutral' ? 'unclaimed' : isMine ? 'yours' : 'opponent'}`}><span className="territory-label">{territoryName(id)}</span>{id === (playerSide === 'A' ? 0 : 14) && <span className="base-tag">HOME</span>}{id === (playerSide === 'A' ? 14 : 0) && <span className="base-tag">BASE</span>}{owner !== 'neutral' && <span className="unit-stack"><i /><i /><i /></span>}</button>;
                    })}
                  </div>
                </div>
                <div className="board-footer"><span><b>{state.board.filter((owner) => owner === playerSide).length}</b> territor{state.board.filter((owner) => owner === playerSide).length === 1 ? 'y' : 'ies'} held</span><span className="mono">3 × 5 GRID</span></div>
              </div>

              <aside className="intel-column">
                <div className="panel status-panel"><div className="panel-head"><div><p className="eyebrow">Match status</p><h2>{phaseLabel}</h2></div><span className="phase-number">{state.phase === 'REVEAL_PHASE' ? '02' : '01'}</span></div>{gameOver && <div className={`battle-over ${state.winner && state.winner !== playerSide ? 'defeat' : 'victory'}`} role="status"><b>{!state.winner ? 'Match complete' : youWonLive ? 'Victory' : isLive ? 'Defeat' : 'Victory'}</b><small>{!state.winner ? 'The match ended without a recorded winner.' : youWonLive ? 'You won the match on-chain.' : isLive ? 'Your opponent recorded the win on-chain.' : 'You won the rehearsal.'}</small></div>}<p className="status-message">{state.message}</p>{!wallet && walletOptions.length === 0 && <div className="connect-card"><div><span className="stat-label">Play live on Midnight</span><p>Connect Lace or 1AM to deploy a contract and submit real moves. Rehearsal stays available below.</p></div><button className="primary-button" onClick={connect} disabled={walletBusy}>{walletBusy ? 'Connecting…' : 'Connect wallet ↗'}</button></div>}{walletOptions.length > 0 && <div className="wallet-picker"><span className="stat-label">Choose your wallet</span><div className="wallet-options">{walletOptions.map((option) => <button key={option.id} className="wallet-option" onClick={() => void connectWithWallet(option.id)} disabled={walletBusy}><strong>{option.name}</strong><small>{option.name.toLowerCase().includes('1am') ? 'In-browser proving' : 'Works with local proof server'}</small></button>)}</div></div>}{wallet && !wallet.match && <div className="deploy-card"><div><span className="stat-label">Start a live match</span><p>Deploy a fresh ShadowArena contract, or join a match your opponent already opened with their contract address. Rehearsal stays available below.</p></div><button className="primary-button" onClick={() => void deploy()} disabled={txBusy}>{txBusy ? 'Deploying…' : 'Deploy contract ↗'}</button><div className="join-row"><label className="join-field">Join with contract address<input value={joinAddress} onChange={(event) => setJoinAddress(event.target.value)} placeholder="64 hex characters" spellCheck={false} autoComplete="off" /></label><button className="secondary-button" onClick={() => void joinWithAddress()} disabled={txBusy || joinBusy || !/^[0-9a-fA-F]{64}$/.test(joinAddress.trim().replace(/^0x/, ''))}>{joinBusy ? 'Joining…' : 'Join match ↗'}</button></div>{matchRegistry.length > 0 && <div className="match-registry"><span className="stat-label">Recent matches</span>{matchRegistry.map((entry) => <div className="registry-row" key={entry.address}><button className="registry-address" title={`Join ${entry.address}`} onClick={() => void joinWithAddress(entry.address)}>{shorten(entry.address)}</button><span className="registry-role mono">{entry.role === 'host' ? 'host' : 'guest'}</span><button className="registry-forget" onClick={() => setMatchRegistry(forgetMatch(activeNetwork, entry.address))} aria-label={`Forget match ${shorten(entry.address)}`}>×</button></div>)}</div>}{contractAddress && matchRegistry.length <= 0 && <div className="match-registry"><span className="stat-label">Configured match</span><div className="registry-row"><button className="registry-address" onClick={() => void joinWithAddress(contractAddress)}>{shorten(contractAddress)}</button><span className="registry-role mono">app config</span></div></div>}</div>}{isLive && state.phase === 'CREATED' && <div className="match-setup"><label className="opponent-field">Opponent coin public key<input value={opponentKey} onChange={(event) => setOpponentKey(event.target.value)} placeholder="64 hex characters" spellCheck={false} autoComplete="off" /></label><button className="primary-button" onClick={() => void createAndOpen()} disabled={txBusy || !/^[0-9a-fA-F]{64}$/.test(opponentKey.trim().replace(/^0x/, ''))}>{txBusy ? 'Creating…' : 'Create match ∥ open state ↗'}</button>{matchAddress && <button className="secondary-button share-button" onClick={() => void copyAddress(matchAddress)} disabled={txBusy}>Copy contract address to invite</button>}</div>}{isLive && needsPrivateOpen && <button className="settle-button" onClick={() => void openLiveState()} disabled={txBusy}>{txBusy ? 'Opening…' : 'Open private state ↗'}</button>}{state.pendingLoss > 0 && state.phase !== 'COMPLETE' && <button className="settle-button" onClick={settle} disabled={txBusy}>Settle {state.pendingLoss} pending loss{state.pendingLoss === 1 ? '' : 'es'}</button>}{isLive && state.phase !== 'CREATED' && state.phase !== 'COMPLETE' && <button className="forfeit-button" onClick={forfeit} disabled={txBusy}>Forfeit live match</button>}<div className="phase-track"><span className={state.phase !== 'CREATED' ? 'phase-complete' : 'phase-current'} /><span className={state.phase === 'REVEAL_PHASE' ? 'phase-current' : state.phase === 'COMPLETE' ? 'phase-complete' : ''} /><span className={state.phase === 'COMPLETE' ? 'phase-complete' : ''} /></div><div className="phase-labels"><span>Commit</span><span>Reveal</span><span>Resolve</span></div></div>
                <div className="panel resource-panel"><div className="panel-head"><div><p className="eyebrow">Your hidden state</p><h2>Private intel</h2></div><span className="privacy-lock">⌁ private</span></div><div className="stat-row"><div><span className="stat-label">Resources</span><strong>{state.resources}</strong><span className="stat-unit">credits</span></div><div><span className="stat-label">Ready troops</span><strong>{state.troops}</strong><span className="stat-unit">units</span></div></div><div className="card-heading"><span className="stat-label">Your hand</span><span className="mono">{availableCards.length}/3 ready</span></div><div className="hand">{state.hand.map((item) => <button key={item} className={`hand-card ${card === item ? 'picked' : ''} ${state.usedCards.includes(item) ? 'used' : ''}`} onClick={() => !state.usedCards.includes(item) && setCard(card === item ? undefined : item)} disabled={state.usedCards.includes(item)}><span className="card-symbol">{CARD_TYPES.indexOf(item) + 1}</span><span>{item}</span>{state.usedCards.includes(item) && <small>spent</small>}</button>)}</div>{isLive && <div className="backup-controls"><div><span className="stat-label">Recovery</span><p>Encrypted provider backup for this wallet and contract.</p></div><div className="backup-buttons"><button className="secondary-button" onClick={() => void downloadBackup()} disabled={txBusy}>Download backup</button><button className="secondary-button" onClick={() => backupInput.current?.click()} disabled={txBusy}>Restore backup</button><input ref={backupInput} type="file" accept="application/json,.json" onChange={(event) => void restoreBackup(event)} hidden /></div></div>}</div>
              </aside>
            </section>

            <section className="lower-grid">
              <div className="panel action-panel"><div className="panel-head"><div><p className="eyebrow">Your move</p><h2>Write the next chapter</h2></div><span className="commitment-hint">fresh salted commitment</span></div><div className="action-tabs" role="tablist" aria-label="Move action">{actions.map((item) => <button key={item} role="tab" aria-selected={action === item} className={action === item ? 'action-tab active' : 'action-tab'} onClick={() => changeAction(item)} disabled={state.phase !== 'COMMIT_PHASE' || state.pendingLoss > 0 || txBusy}><span>{item === 'ATTACK' ? '↗' : item === 'RECON' ? '⌕' : item === 'DEFEND' ? '◈' : item === 'BUILD' ? '+' : '—'}</span>{actionLabel[item]}</button>)}</div><div className="move-form"><label>Origin <select value={origin} onChange={(event) => setOrigin(Number(event.target.value))} disabled={state.phase !== 'COMMIT_PHASE' || txBusy}>{state.board.map((owner, id) => owner === playerSide && <option key={id} value={id}>{territoryName(id)} · yours</option>)}</select></label><label>Target <select value={target} onChange={(event) => setTarget(Number(event.target.value))} disabled={state.phase !== 'COMMIT_PHASE' || txBusy}>{state.board.map((owner, id) => <option key={id} value={id}>{territoryName(id)} · {owner === playerSide ? 'yours' : owner === 'neutral' ? 'open' : 'opponent'}</option>)}</select></label>{action === 'ATTACK' && <label>Troops <input type="number" min="2" max={maxTroops} value={Math.min(troops, maxTroops)} disabled={state.phase !== 'COMMIT_PHASE' || txBusy} onChange={(event) => setTroops(Math.max(2, Math.min(maxTroops, Number(event.target.value))))} aria-describedby="troops-hint" /><small id="troops-hint" className="field-hint">{Math.min(9, state.troops)} available</small></label>}</div><div className="action-footer"><div className="move-summary"><span className="summary-icon">{action === 'ATTACK' ? '↗' : '◌'}</span><span><b>{actionLabel[action]}</b> from {territoryName(origin)} to {territoryName(target)}{card ? ` with ${card}` : ''}</span></div>{state.phase === 'COMMIT_PHASE' ? <button className="primary-button" onClick={commit} disabled={txBusy || state.pendingLoss > 0}>{txBusy ? 'Submitting…' : 'Seal commitment'} <span>↗</span></button> : state.phase === 'REVEAL_PHASE' ? <button className="primary-button reveal-button" onClick={reveal} disabled={txBusy}>{txBusy ? 'Proving…' : 'Reveal & resolve'} <span>↗</span></button> : <button className="secondary-button" onClick={() => (isLive ? void deploy(true) : reset())} disabled={txBusy}>{isLive ? 'Deploy new contract ↗' : 'Start another rehearsal'}</button>}</div></div>

              <div className="panel events-panel"><div className="panel-head"><div><p className="eyebrow">{isLive ? 'Chain record' : 'Rehearsal log'}</p><h2>Match log</h2></div><span className="recording"><span /> {isLive ? 'synced' : 'local'}</span></div><div className="events">{state.events.slice(0, 6).map((event, index) => <div className="event" key={`${event}-${index}`}><span className={`event-marker ${index === 0 ? 'latest' : ''}`} /><span>{event}</span><time>{index === 0 ? 'now' : `${index}r ago`}</time></div>)}</div>{lastReceipt && (() => {
  const receiptHref = isLive ? explorerTxUrl(activeNetwork, lastReceipt) : undefined;
  return <div className="receipt-note"><span>↗</span><p><b>Latest transaction{lastAction ? ` · ${lastAction}` : ''}{receiptHref ? ' · viewable on the Midnight explorer' : ''}</b><br /><small className="mono">{receiptHref ? <a href={receiptHref} target="_blank" rel="noreferrer">{lastReceipt}</a> : lastReceipt}</small></p></div>;
})()}<div className="verification-note"><span>{isLive ? '✓' : '◌'}</span><p><b>{isLive ? 'Proof-backed match' : 'Rehearsal only'}</b><br /><small>{isLive ? 'Public outcomes are synced from the Midnight indexer; private state stays in the encrypted wallet store.' : 'This local rehearsal does not submit transactions or claim on-chain privacy.'}</small></p></div></div>
            </section>
          </>
        )}
      </main>
      <footer className="footer"><span>ShadowArena protocol</span><span className="footer-center">Private strategy, publicly verifiable.</span><a href="https://docs.midnight.network" target="_blank" rel="noreferrer">Midnight docs ↗</a></footer>
    </div>
  );
}

function RulesPanel({ onBack }: { readonly onBack: () => void }) {
  return <section className="rules-page"><p className="eyebrow">Protocol notes</p><h1>Fair play, without<br /><em>the open hand.</em></h1><div className="rules-grid"><article><span className="rule-number">01</span><h2>Commit privately</h2><p>Your action, target, card, and fresh move salt are committed before either player sees the other move.</p></article><article><span className="rule-number">02</span><h2>Reveal with proof</h2><p>The contract checks ownership, resources, card usage, adjacency, and troop limits from your private state.</p></article><article><span className="rule-number">03</span><h2>Resolve in public</h2><p>Only the outcome becomes public: captures, losses, and the next round. Your unused hand stays hidden.</p></article></div><div className="cards-reference"><div className="panel-head"><div><p className="eyebrow">Battle cards</p><h2>What each card does</h2></div><span className="panel-caption">usable with their matching action</span></div><div className="cards-table">{cardReference.map((entry) => <div className="cards-row" key={entry.name}><span className="card-symbol">{CARD_TYPES.indexOf(entry.name as CardType) + 1}</span><div><b>{entry.name}</b><small>{entry.effect}</small></div><span className="mono">{entry.with}</span></div>)}</div></div><button className="secondary-button" onClick={onBack}>Back to battle room ↗</button></section>;
}

const cardReference: readonly { readonly name: string; readonly effect: string; readonly with: string }[] = [
  { name: 'Attack boost', effect: 'Your attack takes no troop losses, even against Counter.', with: 'attack' },
  { name: 'Shield', effect: 'Your attack takes no troop losses, even against Counter.', with: 'attack' },
  { name: 'Heal', effect: 'Heal +10 resources at reveal, before the round cost.', with: 'any' },
  { name: 'Ambush', effect: 'Break a defense on your target; the defender loses 3 troops.', with: 'attack' },
  { name: 'Spy', effect: 'Attack without paying the 10-credit resource cost.', with: 'attack' },
  { name: 'Teleport', effect: 'Strike any territory — adjacency not required.', with: 'attack' },
  { name: 'Counter', effect: 'When your defense holds, the attacker loses 2 extra troops.', with: 'defend' },
  { name: 'Rally', effect: 'Gain one extra available troop the moment you reveal.', with: 'any' },
];
