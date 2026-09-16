import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  CARD_TYPES,
  BOARD_SIZE,
  territoryName,
  type Action,
  type CardType,
  type Move,
  type PlayerSide,
} from '@shadowarena/api/game';
import type { ShadowArenaPrivateState } from '@shadowarena/contract';
import { fromHex } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { ConnectedWallet, ShadowArenaBackup } from './chain';
import { ShadowArenaSimulator, actionLabel, type SimulationState } from './simulator';
import { applyLiveSnapshot } from './live-state';
import './styles.css';

const networkId = import.meta.env.VITE_NETWORK_ID ?? 'preprod';
const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS ?? '';
const configuredOpponent = import.meta.env.VITE_OPPONENT_PUBLIC_KEY ?? '';
const actions: Action[] = ['RECON', 'ATTACK', 'DEFEND', 'BUILD', 'PASS'];

const shorten = (value: string): string => value.length < 18 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;

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

export default function App() {
  const simulator = useRef(new ShadowArenaSimulator());
  const [state, setState] = useState<SimulationState>(simulator.current.state);
  const [action, setAction] = useState<Action>('ATTACK');
  const [origin, setOrigin] = useState(0);
  const [target, setTarget] = useState(1);
  const [troops, setTroops] = useState(2);
  const [card, setCard] = useState<CardType | undefined>();
  const [wallet, setWallet] = useState<ConnectedWallet | undefined>();
  const [walletBusy, setWalletBusy] = useState(false);
  const [txBusy, setTxBusy] = useState(false);
  const [playerSide, setPlayerSide] = useState<PlayerSide>('A');
  const [lastReceipt, setLastReceipt] = useState<string | undefined>();
  const [opponentKey, setOpponentKey] = useState(configuredOpponent);
  const [notice, setNotice] = useState<string | undefined>();
  const [activePanel, setActivePanel] = useState<'battle' | 'rules'>('battle');
  const backupInput = useRef<HTMLInputElement>(null);

  const isLive = Boolean(wallet?.match);
  const needsPrivateOpen = Boolean(wallet?.match && state.phase !== 'CREATED' && state.phase !== 'COMPLETE' && !state.publicStateOpen);
  const availableCards = useMemo(() => state.hand.filter((item) => !state.usedCards.includes(item)), [state.hand, state.usedCards]);
  const move: Move = { action, origin, territory: target, troops: action === 'ATTACK' ? troops : 0, card };

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

  const changeAction = (next: Action) => {
    setAction(next);
    if (next === 'ATTACK' && target === 0) setTarget(1);
  };

  const selectTerritory = (id: number) => {
    if (action === 'ATTACK' || action === 'RECON') setTarget(id);
    else setTarget(id);
  };

  const commit = async () => {
    if (txBusy) return;
    if (isLive && wallet?.match) {
      setTxBusy(true);
      setNotice('Submitting a private commitment to Preprod…');
      try {
        const receipt = await wallet.match.submitCommit(move);
        setLastReceipt(receipt.txId);
        const privateState = await wallet.match.getPrivateState();
        if (privateState) setState((previous) => ({ ...previous, ...privateStateView(privateState) }));
        setNotice(`Commitment sealed on Preprod. Transaction ${shorten(receipt.txId)}.`);
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Commitment failed.'); }
      finally { setTxBusy(false); }
      return;
    }
    setState(simulator.current.commit(move));
  };

  const reveal = async () => {
    if (txBusy) return;
    if (isLive && wallet?.match) {
      setTxBusy(true);
      setNotice('Generating proof and revealing the move…');
      try {
        const receipt = await wallet.match.revealMove(move);
        setLastReceipt(receipt.txId);
        const privateState = await wallet.match.getPrivateState();
        if (privateState) setState((previous) => ({ ...previous, ...privateStateView(privateState) }));
        setNotice(`Move revealed and submitted. Transaction ${shorten(receipt.txId)}.`);
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
        const privateState = await wallet.match.getPrivateState();
        if (privateState) setState((previous) => ({ ...previous, ...privateStateView(privateState) }));
        setNotice(`Private losses settled. Transaction ${shorten(receipt.txId)}.`);
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
      setState((previous) => ({ ...previous, phase: 'COMPLETE', message: 'You forfeited the live match. The opponent is recorded as the winner.' }));
      setNotice(`Match forfeited. Transaction ${shorten(receipt.txId)}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Forfeit failed.'); }
    finally { setTxBusy(false); }
  };

  const reset = () => {
    if (isLive) {
      setNotice('This live match is complete. Reconnect with a new contract to start another live match.');
      return;
    }
    setLastReceipt(undefined);
    setPlayerSide('A');
    setAction('ATTACK');
    setOrigin(0);
    setTarget(1);
    setTroops(2);
    setCard(undefined);
    setState(simulator.current.reset());
  };

  const connect = async () => {
    setWalletBusy(true);
    setNotice(undefined);
    try {
      const { connectToMidnight, findWalletInstalled } = await import('./chain.js');
      if (!findWalletInstalled()) throw new Error('Lace was not detected. Install the Midnight wallet or stay in rehearsal mode.');
      const privateStoragePassword = window.prompt('Create or enter your ShadowArena private-state password (16+ characters). It is not stored by this app.');
      if (!privateStoragePassword) throw new Error('A private-state password is required for live mode.');
      const connected = await connectToMidnight(networkId, contractAddress || undefined, [3n, 1n, 4n], privateStoragePassword);
      setWallet(connected);
      setNotice(connected.match ? 'Connected to the live match.' : 'Wallet connected. Set VITE_CONTRACT_ADDRESS to join a live match.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Wallet connection failed.');
    } finally { setWalletBusy(false); }
  };

  const deploy = async () => {
    if (!wallet || txBusy) return;
    setTxBusy(true);
    setNotice('Deploying the ShadowArena contract to Preprod…');
    try {
      const { deployLiveMatch } = await import('./chain.js');
      const deployed = await deployLiveMatch(wallet, [3n, 1n, 4n]);
      setWallet(deployed);
      setNotice(`Contract deployed at ${shorten(String(deployed.match?.deployedContractAddress))}. Configure this address for the other player.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Contract deployment failed.'); }
    finally { setTxBusy(false); }
  };

  const createAndOpen = async () => {
    if (!wallet?.match || txBusy) return;
    const normalized = opponentKey.trim().replace(/^0x/, '');
    if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
      setNotice('Enter the opponent coin public key as exactly 32 bytes (64 hex characters).');
      return;
    }
    setTxBusy(true);
    setNotice('Creating the match and opening your private state…');
    try {
      const created = await wallet.match.createMatch(fromHex(normalized));
      setLastReceipt(created.txId);
      const opened = await wallet.match.openState();
      setLastReceipt(opened.txId);
      setState((previous) => ({ ...previous, phase: 'COMMIT_PHASE', publicStateOpen: true, message: 'Match created. Waiting for the opponent to open private state.' }));
      setNotice(`Match created. Opening transaction ${shorten(opened.txId)}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Match creation failed.'); }
    finally { setTxBusy(false); }
  };

  const openLiveState = async () => {
    if (!wallet?.match || txBusy) return;
    setTxBusy(true);
    setNotice('Opening your private state on Preprod…');
    try {
      const receipt = await wallet.match.openState();
      setLastReceipt(receipt.txId);
      setState((previous) => ({ ...previous, publicStateOpen: true }));
      setNotice(`Private state opened. Transaction ${shorten(receipt.txId)}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Opening private state failed.'); }
    finally { setTxBusy(false); }
  };

  const downloadBackup = async () => {
    if (!wallet || !wallet.match || txBusy) return;
    setTxBusy(true);
    setNotice('Preparing an encrypted private-state backup…');
    try {
      const { exportWalletBackup } = await import('./chain.js');
      const backup = await exportWalletBackup(wallet);
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
    setTxBusy(true);
    setNotice('Restoring the encrypted private state…');
    try {
      const backup = parseBackup(JSON.parse(await file.text()));
      if (!window.confirm('Restore this backup and overwrite matching local state for this contract?')) return;
      const { importWalletBackup } = await import('./chain.js');
      const result = await importWalletBackup(wallet, backup);
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
          <span className="network-pill"><span className="status-dot" />{networkId}</span>
          {wallet?.match ? <button className="wallet-button" onClick={() => void (state.phase === 'CREATED' ? createAndOpen() : needsPrivateOpen ? openLiveState() : Promise.resolve())} disabled={txBusy || (state.phase !== 'CREATED' && !needsPrivateOpen)}>{txBusy ? 'Preparing…' : state.phase === 'CREATED' ? 'Create match' : needsPrivateOpen ? 'Open private state' : shorten(wallet.match.deployedContractAddress)}</button> : wallet ? <button className="wallet-button" onClick={() => void deploy()} disabled={txBusy}>{txBusy ? 'Deploying…' : 'Deploy match'}</button> : <button className="wallet-button" onClick={connect} disabled={walletBusy}>{walletBusy ? 'Connecting…' : 'Connect wallet'}</button>}
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
                <div className="board-footer"><span><b>{state.board.filter((owner) => owner === playerSide).length}</b> territories held</span><span className="mono">3 × 5 GRID</span></div>
              </div>

              <aside className="intel-column">
                <div className="panel status-panel"><div className="panel-head"><div><p className="eyebrow">Match status</p><h2>{phaseLabel}</h2></div><span className="phase-number">{state.phase === 'REVEAL_PHASE' ? '02' : '01'}</span></div><p className="status-message">{state.message}</p>{isLive && state.phase === 'CREATED' && <label className="opponent-field">Opponent coin public key<input value={opponentKey} onChange={(event) => setOpponentKey(event.target.value)} placeholder="64 hex characters" spellCheck={false} /></label>}{state.pendingLoss > 0 && state.phase !== 'COMPLETE' && <button className="settle-button" onClick={settle} disabled={txBusy}>Settle {state.pendingLoss} pending loss{state.pendingLoss === 1 ? '' : 'es'}</button>}{isLive && state.phase !== 'CREATED' && state.phase !== 'COMPLETE' && <button className="forfeit-button" onClick={forfeit} disabled={txBusy}>Forfeit live match</button>}<div className="phase-track"><span className="phase-complete" /><span className={state.phase === 'REVEAL_PHASE' ? 'phase-current' : ''} /></div><div className="phase-labels"><span>Commit</span><span>Reveal</span><span>Resolve</span></div></div>
                <div className="panel resource-panel"><div className="panel-head"><div><p className="eyebrow">Your hidden state</p><h2>Private intel</h2></div><span className="privacy-lock">⌁ private</span></div><div className="stat-row"><div><span className="stat-label">Resources</span><strong>{state.resources}</strong><span className="stat-unit">credits</span></div><div><span className="stat-label">Ready troops</span><strong>{state.troops}</strong><span className="stat-unit">units</span></div></div><div className="card-heading"><span className="stat-label">Your hand</span><span className="mono">{availableCards.length}/3 ready</span></div><div className="hand">{state.hand.map((item) => <button key={item} className={`hand-card ${card === item ? 'picked' : ''} ${state.usedCards.includes(item) ? 'used' : ''}`} onClick={() => !state.usedCards.includes(item) && setCard(card === item ? undefined : item)} disabled={state.usedCards.includes(item)}><span className="card-symbol">{CARD_TYPES.indexOf(item) + 1}</span><span>{item}</span>{state.usedCards.includes(item) && <small>spent</small>}</button>)}</div>{isLive && <div className="backup-controls"><div><span className="stat-label">Recovery</span><p>Encrypted provider backup for this wallet and contract.</p></div><div className="backup-buttons"><button className="secondary-button" onClick={() => void downloadBackup()} disabled={txBusy}>Download backup</button><button className="secondary-button" onClick={() => backupInput.current?.click()} disabled={txBusy}>Restore backup</button><input ref={backupInput} type="file" accept="application/json,.json" onChange={(event) => void restoreBackup(event)} hidden /></div></div>}</div>
              </aside>
            </section>

            <section className="lower-grid">
              <div className="panel action-panel"><div className="panel-head"><div><p className="eyebrow">Your move</p><h2>Write the next chapter</h2></div><span className="commitment-hint">fresh salted commitment</span></div><div className="action-tabs" role="tablist" aria-label="Move action">{actions.map((item) => <button key={item} role="tab" aria-selected={action === item} className={action === item ? 'action-tab active' : 'action-tab'} onClick={() => changeAction(item)} disabled={state.phase !== 'COMMIT_PHASE' || state.pendingLoss > 0 || txBusy}><span>{item === 'ATTACK' ? '↗' : item === 'RECON' ? '⌕' : item === 'DEFEND' ? '◈' : item === 'BUILD' ? '+' : '—'}</span>{actionLabel[item]}</button>)}</div><div className="move-form"><label>Origin <select value={origin} onChange={(event) => setOrigin(Number(event.target.value))} disabled={state.phase !== 'COMMIT_PHASE' || txBusy}>{state.board.map((owner, id) => owner === playerSide && <option key={id} value={id}>{territoryName(id)} · yours</option>)}</select></label><label>Target <select value={target} onChange={(event) => setTarget(Number(event.target.value))} disabled={state.phase !== 'COMMIT_PHASE' || txBusy}>{state.board.map((owner, id) => <option key={id} value={id}>{territoryName(id)} · {owner === playerSide ? 'yours' : owner === 'neutral' ? 'open' : 'opponent'}</option>)}</select></label>{action === 'ATTACK' && <label>Troops <input type="number" min="2" max={Math.max(2, state.troops)} value={troops} disabled={state.phase !== 'COMMIT_PHASE' || txBusy} onChange={(event) => setTroops(Math.max(2, Number(event.target.value)))}/></label>}</div><div className="action-footer"><div className="move-summary"><span className="summary-icon">{action === 'ATTACK' ? '↗' : '◌'}</span><span><b>{actionLabel[action]}</b> from {territoryName(origin)} to {territoryName(target)}{card ? ` with ${card}` : ''}</span></div>{state.phase === 'COMMIT_PHASE' ? <button className="primary-button" onClick={commit} disabled={txBusy || state.pendingLoss > 0}>{txBusy ? 'Submitting…' : 'Seal commitment'} <span>↗</span></button> : state.phase === 'REVEAL_PHASE' ? <button className="primary-button reveal-button" onClick={reveal} disabled={txBusy}>{txBusy ? 'Proving…' : 'Reveal & resolve'} <span>↗</span></button> : <button className="secondary-button" onClick={reset} disabled={isLive}> {isLive ? 'Live match complete' : 'Start another rehearsal'}</button>}</div></div>

              <div className="panel events-panel"><div className="panel-head"><div><p className="eyebrow">{isLive ? 'Chain record' : 'Rehearsal log'}</p><h2>Match log</h2></div><span className="recording"><span /> {isLive ? 'synced' : 'local'}</span></div><div className="events">{state.events.slice(0, 6).map((event, index) => <div className="event" key={`${event}-${index}`}><span className={`event-marker ${index === 0 ? 'latest' : ''}`} /><span>{event}</span><time>{index === 0 ? 'now' : `${index}r ago`}</time></div>)}</div>{lastReceipt && <div className="receipt-note"><span>↗</span><p><b>Latest transaction</b><br /><small className="mono">{lastReceipt}</small></p></div>}<div className="verification-note"><span>{isLive ? '✓' : '◌'}</span><p><b>{isLive ? 'Proof-backed match' : 'Rehearsal only'}</b><br /><small>{isLive ? 'Public outcomes are synced from the Midnight indexer; private state stays in the encrypted wallet store.' : 'This local rehearsal does not submit transactions or claim on-chain privacy.'}</small></p></div></div>
            </section>
          </>
        )}
      </main>
      <footer className="footer"><span>ShadowArena protocol</span><span className="footer-center">Private strategy, publicly verifiable.</span><a href="https://docs.midnight.network" target="_blank" rel="noreferrer">Midnight docs ↗</a></footer>
    </div>
  );
}

function RulesPanel({ onBack }: { readonly onBack: () => void }) {
  return <section className="rules-page"><p className="eyebrow">Protocol notes</p><h1>Fair play, without<br /><em>the open hand.</em></h1><div className="rules-grid"><article><span className="rule-number">01</span><h2>Commit privately</h2><p>Your action, target, card, and fresh move salt are committed before either player sees the other move.</p></article><article><span className="rule-number">02</span><h2>Reveal with proof</h2><p>The contract checks ownership, resources, card usage, adjacency, and troop limits from your private state.</p></article><article><span className="rule-number">03</span><h2>Resolve in public</h2><p>Only the outcome becomes public: captures, losses, and the next round. Your unused hand stays hidden.</p></article></div><button className="secondary-button" onClick={onBack}>Back to battle room ↗</button></section>;
}
