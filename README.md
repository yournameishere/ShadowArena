# ShadowArena

ShadowArena is a two-player tactical battle that demonstrates Midnight's privacy model with a small, playable game. Each player keeps resources, troops, cards, and salts in encrypted private state. The contract stores public commitments and public outcomes, then verifies commit-and-reveal moves without exposing the rest of a player's hand.

The app has two deliberately separate modes:

- Rehearsal mode is instant, local, and safe for demos. It never submits a transaction.
- Live mode connects Lace to Midnight, generates proofs through the configured local proof server, and syncs public state from the selected network's indexer.

## What is shipped

The current MVP is a complete two-player match lifecycle:

1. Player A deploys a contract or joins an existing address.
2. Player A supplies Player B's 32-byte coin public key and creates the match.
3. Both players open their private state.
4. Both players submit a salted move commitment.
5. Both players reveal the move; the contract validates the private state, move legality, resource cost, card ownership, and card usage.
6. The contract resolves captures and private troop losses, then advances the round or records a winner.
7. A player may explicitly forfeit a running match.

The board is a 3 x 5 territory grid. Actions are Recon, Attack, Defend, Build, and Pass. The shipped rules include adjacency, teleport and combat cards, resource costs, troop limits, territory capture, pending-loss settlement, win-by-base, and win-by-territory.

The app also includes:

- responsive battle-room UI with keyboard focus states and a skip link;
- a rules view with hash navigation that survives refresh and browser back/forward;
- inline transaction and indexer error notices;
- encrypted Midnight private-state and signing-key backup/restore;
- official Preprod, Preview, Mainnet, and local endpoint configuration;
- compiled Compact proving assets copied into the browser build;
- unit tests for shared rules, live-ledger projection, rehearsal behavior, and compiled Compact circuits.

## Privacy boundary

The ledger exposes the match lifecycle, player public keys, commitments, revealed moves, territory ownership, pending losses, and winner. The private state provider keeps each player's resources, troops, cards, used-card mask, state salt, and move salts encrypted in the browser's account-scoped Level store.

This is not a server-side game with a hidden authoritative database. Rehearsal mode is local only. Live mode is the mode that submits Midnight transactions and should be described as on-chain in a demo.

## Repository layout

    contract/  Compact contract, witnesses, generated contract package, and circuit assets
    api/       shared rules, network presets, and the live contract adapter
    ui/        React/Vite battle room, Lace integration, backups, and visual design
    scripts/   deployment build helpers

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Compact 0.31.1, installed in WSL on Windows or available on PATH on Linux/macOS
- Lace with DApp Connector API 4.x for live mode
- Docker Desktop and the Midnight local stack for local transaction-level E2E tests
- a local Midnight proof server for remote Preprod/Preview/Mainnet transactions

The browser must be served from a secure origin for non-loopback deployments. The proof server remains local by design; Midnight does not provide a public proving endpoint for this app.

## Install and run the rehearsal

From the repository root:

    npm ci
    npm run dev

On Windows, the Compact compile script invokes WSL. The first compile creates generated files under contract/src/managed and copied browser assets under ui/public; those generated directories are ignored by Git and are recreated by the build.

Open the Vite URL printed by the command, select a move, seal the commitment, reveal it, and settle any pending loss. The rehearsal uses the same shared validation rules as the browser live adapter but does not claim that anything is on-chain.

## Verify the project

    npm test
    npm run typecheck
    npm run build
    npm audit --audit-level=moderate

The normal automated suite covers 19 tests across the API, Compact contract, and UI. npm run build also compiles all six Compact circuits and copies the prover, verifier, and ZKIR assets needed by the browser.

For a real transaction-level test, start the official Midnight local development stack and proof server, fund two test accounts, then exercise deploy, open, commit, reveal, settle, and forfeit with the wallet/testkit. A funded wallet, Docker daemon, and local stack are intentionally not stored in this repository, so CI does not fabricate a chain test.

## Configure live Preprod

Copy ui/.env.example to ui/.env.local and set:

    VITE_NETWORK_ID=preprod
    VITE_CONTRACT_ADDRESS=
    VITE_OPPONENT_PUBLIC_KEY=

Leave VITE_CONTRACT_ADDRESS empty when the connected Lace wallet should deploy a new contract. Set it to the 64-character contract address when joining an existing match. VITE_OPPONENT_PUBLIC_KEY is optional and pre-fills the create-match form.

Start the proof server separately:

    docker run --rm -p 6300:6300 midnightntwrk/proof-server:8.1.0 midnight-proof-server -v

Then run npm run dev, connect Lace on the same network, and enter a private-state password of at least 16 characters. The password is never stored by ShadowArena; use the same password when reconnecting the same account. Fund the wallet with Preprod tNIGHT and tDUST using the official [Preprod faucet](https://midnight-tmnight-preprod.nethermind.dev/).

The app uses the official endpoints from Midnight's [network and environment guide](https://docs.midnight.network/guides/networks-and-environments):

| Network | RPC | Indexer | Explorer |
| --- | --- | --- | --- |
| Preview | https://rpc.preview.midnight.network | https://indexer.preview.midnight.network/api/v4/graphql | [preview explorer](https://preview.midnightexplorer.com/) |
| Preprod | https://rpc.preprod.midnight.network | https://indexer.preprod.midnight.network/api/v4/graphql | [Preprod explorer](https://preprod.midnightexplorer.com/) |
| Mainnet | https://rpc.mainnet.midnight.network | https://indexer.mainnet.midnight.network/api/v4/graphql | [mainnet explorer](https://midnightexplorer.com/) |

Network ID and endpoints are kept together in api/src/config.ts. The app calls setNetworkId before initializing providers, and the proof server defaults to local http://127.0.0.1:6300 as required by the Midnight docs.

## Backups and recovery

Use Download backup from the live private-intel panel before clearing browser data or moving to another device. The JSON is encrypted by the Midnight provider; keep the file and its password separately. Restore is restricted to the same network and contract address, and imports both private states and signing keys with overwrite semantics.

If a wallet reconnects to a contract whose private state is missing, the app stops with a recovery message instead of silently creating a new state that cannot prove the old commitments. This is intentional: the Level provider is encrypted storage, not a recovery service.

## Vercel deployment

The repository includes vercel.json and scripts/vercel-build.mjs. Vercel's Linux build installs Compact 0.31.1, compiles the contract, builds the API, and publishes ui/dist.

After authenticating with the Vercel CLI:

    vercel link
    vercel env add VITE_NETWORK_ID production
    vercel env add VITE_CONTRACT_ADDRESS production
    vercel env add VITE_OPPONENT_PUBLIC_KEY production
    vercel --prod

VITE_CONTRACT_ADDRESS and VITE_OPPONENT_PUBLIC_KEY are client-visible configuration, not secrets. Never place a wallet seed, mnemonic, private-state password, proof-server credential, or signing key in Vercel environment variables or this repository. A public deployment can run rehearsal mode without a contract address; live mode still requires Lace and a proof server reachable from the user's browser.

## Contract deployment boundary

ShadowArena can deploy a contract from the connected Lace wallet through the live UI. This repository does not contain a funded deployment wallet, a seed, or a Preprod contract address, so no fake address is committed and no transaction is run automatically during build or deployment. A real on-chain deployment requires the operator to connect a funded wallet, run the local proof server, and approve the transactions in Lace.

## Scope and next improvements

The shipped scope is intentionally one two-player match. Matchmaking, invitations, server-side lobby discovery, spectator/replay mode, tournaments, rankings, chat, automatic timeout arbitration, and a richer troop-position model are not silently represented as complete features. They are the next product layer and would require additional contracts, indexing, or coordination design.

The safest next additions are a match registry/invitation flow, explicit block-height timeouts, a replayable public event stream, and testkit-backed local E2E coverage for two real wallets. Those additions can build on the current ShadowArenaLiveAPI without mixing UI-only rehearsal state with chain state.

## Security notes

- Do not commit .env.local, wallet secrets, backups, or generated private keys.
- Run a proof server you control when privacy and availability matter.
- Treat contract addresses and public transaction IDs as public data.
- Review and test Compact changes before deploying a new contract; existing contracts are not upgraded by rebuilding the frontend.

