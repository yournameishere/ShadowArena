# ShadowArena

ShadowArena is a privacy-first, two-player tactical battle room built for Midnight. It lets players choose moves privately, prove that those moves follow the game rules, and publish only the information that the match needs to settle on-chain.

The product is designed around one simple idea: strategy should remain private while the result remains verifiable. A player can keep their resources, troops, cards, state salt, and move salt hidden while Midnight verifies commitments, reveals, costs, card ownership, movement, combat, territory changes, and victory conditions.

## What problem the app solves

In a conventional online game, the server usually sees every player's hidden state and users must trust that server to enforce the rules. ShadowArena uses Midnight's private-state model instead:

- the browser owns each player's encrypted private state;
- the contract receives commitments and zero-knowledge proofs instead of the full hidden state;
- the public ledger records enough information for the match to be auditable;
- the contract, rather than a UI or centralized game server, decides whether a move is legal.

This makes ShadowArena both a small game and a practical demonstration of private state, proving, wallet integration, and public settlement on Midnight Preprod.

## Two modes

### Rehearsal mode

Rehearsal mode is the fast demo path. It runs entirely in the browser, uses the same shared move validation rules as the live adapter, and never sends a transaction. It is useful for learning the flow, checking the UI, and demonstrating the rules without a wallet, proof server, funds, or deployed contract.

The rehearsal log is local to the current page session. It must not be presented as a blockchain result.

### Live mode

Live mode connects to a Midnight DApp Connector wallet, initializes encrypted private state, creates or joins a real contract, and submits transactions to the selected network. The live path is the mode to use when a demo needs genuine on-chain state and public transaction identifiers.

The current production frontend is deployed at [shadowarena-six.vercel.app](https://shadowarena-six.vercel.app). The frontend is ready for live use, but a contract is not automatically deployed during a Vercel build. A funded operator must connect a wallet and approve the deployment from the app.

## How a live match works

The complete flow is intentionally split into clear stages:

1. **Connect a wallet.** The UI discovers Midnight DApp Connector API 4.x wallets exposed by the browser, including Lace and 1AM. If more than one wallet is available, the player chooses which one to use.
2. **Prepare private state.** ShadowArena creates the Midnight providers for the selected network. The browser generates a random local unlock key so the normal connection flow goes directly to the live setup without an extra password prompt.
3. **Deploy or join.** The player can deploy a fresh contract from the visible `Deploy contract` button or enter an existing contract address. Deploying and joining require wallet approval and a funded account.
4. **Create the match.** The first player supplies the opponent's public coin key and initializes the board and private state.
5. **Open private state.** Each player opens their own encrypted state. The browser keeps private resources, troops, cards, salts, and used-card information in the Midnight private-state provider.
6. **Commit a move.** A player selects an action, origin, target, troop count, card, and salt. The contract receives a salted commitment, not the complete hidden move.
7. **Reveal the move.** During the reveal stage, the player submits the move and salt. Midnight proves that the reveal matches the commitment and that the private state, card, resource balance, and board rules are valid.
8. **Resolve the round.** The contract applies resource costs, movement, combat, territory ownership, card effects, and pending troop losses. The public match projection updates from the indexer.
9. **Settle and continue.** Pending losses can be settled, the round advances, and the players continue until a win condition is reached. A player can also explicitly forfeit a running match.
10. **Verify the result.** Transaction IDs, commitments, reveals, ownership, pending losses, and the winner can be checked on the configured Midnight explorer.

## Game rules in the shipped MVP

The board is a 3 x 5 territory grid with two bases. Players can use:

- **Recon** to inspect the public tactical situation;
- **Attack** to contest an adjacent territory;
- **Defend** to protect a position;
- **Build** to spend resources and improve the board state;
- **Pass** to advance without taking an offensive action.

The contract and shared rules cover adjacency, legal origin and target territories, resource costs, troop limits, territory capture, teleport and combat cards, card ownership, one-time card usage, pending-loss settlement, win-by-base, win-by-territory, and forfeiture.

The UI presents a compact tactical board, private intel, action controls, commit/reveal progress, match status, a transaction log, and recovery/error notices. The board is deliberately small so the privacy and settlement lifecycle stays easy to understand.

## What is private and what is public

| Private to the player | Public on the ledger or indexer |
| --- | --- |
| resources and resource history | match and round lifecycle |
| troop details in private state | player public keys |
| cards and used-card mask | salted move commitments |
| state salt and move salts | revealed moves and salts when revealed |
| hidden proof inputs | territory ownership and pending losses |
| local encrypted signing/private-state material | winner, forfeiture, and transaction IDs |

The browser private-state store is encrypted and account-scoped. ShadowArena does not upload the hidden state to an application server. Rehearsal state is separate from live Midnight state and is never silently promoted to an on-chain result.

## Wallet support and direct connection UX

ShadowArena uses the official Midnight DApp Connector API rather than a custom wallet protocol. It detects compatible wallets from `window.midnight`, validates that the connector exposes API 4.x, and shows the wallet name and icon returned by the connector.

- **Lace** is supported through the standard connector. Lace deployments and transactions require a local proof server reachable from the browser.
- **1AM** is supported through the standard connector. When the connector exposes `getProvingProvider`, ShadowArena uses the wallet's in-browser proving provider.
- **Multiple wallets** are shown as separate choices. The app never guesses silently when the player has several compatible connectors installed.
- **No initial private-password gate** is shown in the normal connect flow. After the wallet connection is approved, ShadowArena creates a browser-local random unlock key and proceeds to the visible `Deploy contract` action.

The direct flow is:

    Connect Lace / 1AM -> approve wallet connection -> Wallet ready -> Deploy contract

This local key is an ergonomic unlock mechanism, not a wallet secret. It is not sent to ShadowArena, Vercel, the API, or the Midnight ledger. Clearing site data, changing browser profiles, or using another device removes access to that local key, which is why backups are important.

## Private-state backups and recovery

Use **Download backup** from the live private-intel panel before clearing browser data or moving to another device. The backup includes the encrypted Midnight private states and signing keys.

The app asks for a separate backup password of at least 16 characters when exporting. Keep the downloaded JSON and its password in different secure locations. On restore, the app asks for that password and imports with overwrite semantics only into the matching network and contract context.

Important recovery boundaries:

- the backup password is not stored in the repository, browser local storage, or Vercel;
- the browser-local unlock key is not a substitute for an exported backup;
- restoring into a different network or contract is rejected;
- if a connected contract has no matching private state, the app stops with a recovery message instead of silently creating an incompatible state;
- losing both the local browser data and the encrypted backup/password can make the private state unrecoverable.

## Architecture

The repository keeps chain logic, shared rules, and presentation separate:

    contract/  Compact contract, witnesses, generated package, circuits, and proving assets
    api/       shared game rules, network presets, and the live contract adapter
    ui/        React/Vite battle room, wallet connection, backups, rehearsal, and styling
    scripts/   build and deployment helpers

The main boundaries are:

- `contract/src/` defines the Compact circuits and witnesses. Contract changes require a new compile and a new deployed contract; rebuilding the frontend does not upgrade an existing contract.
- `api/src/rules.ts` is the shared deterministic rules layer used by tests, rehearsal, and the live projection.
- `api/src/live.ts` maps Midnight ledger state and transactions into the UI-facing match model.
- `ui/src/chain.ts` owns wallet discovery, network selection, provider initialization, proving-provider selection, deployment, transaction calls, and encrypted backup operations.
- `ui/src/App.tsx` owns the user flow and keeps rehearsal mode visibly separate from the live chain path.
- `ui/src/styles.css` contains the responsive visual system, focus states, reduced-motion behavior, and status/error treatments.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Compact 0.31.1, installed in WSL on Windows or available on PATH on Linux/macOS
- Lace or 1AM with Midnight DApp Connector API 4.x for live mode
- Docker Desktop and the Midnight local stack for local transaction-level E2E tests
- a local Midnight proof server for remote Preprod/Preview/Mainnet transactions when the selected wallet does not provide in-browser proving
- a funded account with network-appropriate tNIGHT and tDUST for deployment and transaction fees

The browser must be served from a secure origin for non-loopback deployments. A proof server is an operator-controlled dependency; the app does not assume that Midnight provides a public proving endpoint for this deployment.

## Install and run locally

From the repository root:

    npm ci
    npm run dev

On Windows, the Compact compile script invokes WSL. The first compile creates generated files under `contract/src/managed` and copied browser assets under `ui/public`; those generated directories are ignored by Git and recreated by the build.

Open the Vite URL printed by the command. You can immediately use rehearsal mode. To use live mode, install Lace or 1AM, configure the network, start the appropriate proof path, and connect the wallet from the battle room.

## Configure live Preprod

Copy `ui/.env.example` to `ui/.env.local` and set:

    VITE_NETWORK_ID=preprod
    VITE_CONTRACT_ADDRESS=
    VITE_OPPONENT_PUBLIC_KEY=

Leave `VITE_CONTRACT_ADDRESS` empty when the connected wallet should deploy a new contract. Set it to a 64-character contract address when joining an existing match. `VITE_OPPONENT_PUBLIC_KEY` is optional and pre-fills the create-match form. These values are client-visible configuration, not secrets.

For Lace, start the proof server separately:

    docker run --rm -p 6300:6300 midnightntwrk/proof-server:8.1.0 midnight-proof-server -v

Then run `npm run dev`, connect the wallet, and use **Deploy contract**. Fund the account with Preprod tNIGHT and tDUST using the official [Preprod faucet](https://midnight-tmnight-preprod.nethermind.dev/). 1AM may use its in-browser proving provider when available; it still needs a funded wallet and network access.

The app uses the official endpoints from Midnight's [network and environment guide](https://docs.midnight.network/guides/networks-and-environments):

| Network | RPC | Indexer | Explorer |
| --- | --- | --- | --- |
| Preview | https://rpc.preview.midnight.network | https://indexer.preview.midnight.network/api/v4/graphql | [Preview explorer](https://preview.midnightexplorer.com/) |
| Preprod | https://rpc.preprod.midnight.network | https://indexer.preprod.midnight.network/api/v4/graphql | [Preprod explorer](https://preprod.midnightexplorer.com/) |
| Mainnet | https://rpc.mainnet.midnight.network | https://indexer.mainnet.midnight.network/api/v4/graphql | [Mainnet explorer](https://midnightexplorer.com/) |

Network IDs and endpoint presets are kept together in `api/src/config.ts`. The app selects the network before initializing providers, and the proof-server default is local `http://127.0.0.1:6300`.

## Verify the project

    npm test
    npm run typecheck
    npm run build
    npm audit --audit-level=moderate

The normal automated suite covers 19 tests across the API, Compact contract, and UI. The build also compiles all six Compact circuits and copies the prover, verifier, and ZKIR assets needed by the browser.

For a real transaction-level test, start the official Midnight local development stack and proof server, fund two test accounts, and exercise deploy, open, commit, reveal, settle, and forfeit with the wallet/testkit. A funded wallet, Docker daemon, and local stack are intentionally not stored in this repository, so CI does not fabricate a chain test or claim that it deployed a contract.

## Production deployment

The repository includes `vercel.json` and `scripts/vercel-build.mjs`. Vercel's Linux build installs Compact 0.31.1, compiles the contract, builds the API, and publishes `ui/dist`.

After authenticating with the Vercel CLI:

    vercel link
    vercel env add VITE_NETWORK_ID production
    vercel env add VITE_CONTRACT_ADDRESS production
    vercel env add VITE_OPPONENT_PUBLIC_KEY production
    vercel --prod

The deployed frontend can run rehearsal mode without a contract address. Live mode still requires the user's compatible wallet, the correct network, a reachable proof path, and enough funds. Never place a wallet seed, mnemonic, private-state password, proof-server credential, signing key, or backup password in Vercel environment variables or this repository.

## Contract deployment boundary

ShadowArena has a visible contract deployment action in the live UI. It calls the Midnight deployment flow through the connected wallet and waits for the resulting contract address before moving into the live match setup.

The repository does not contain a funded deployment wallet, a seed, or a committed Preprod contract address. Therefore, the frontend build and Vercel deployment do not deploy a contract automatically. A real deployment requires the operator to connect a funded Lace or 1AM wallet, provide the required proof path, click `Deploy contract`, and approve the wallet transactions. The resulting address should then be recorded privately or configured as `VITE_CONTRACT_ADDRESS` for players who need to join it.

## Troubleshooting

- **No wallet appears:** install Lace or 1AM, unlock it, refresh the page, and confirm it exposes Midnight DApp Connector API 4.x.
- **The wrong network is shown:** switch the wallet to the selected Preprod/Preview/Mainnet network and reconnect. The app rejects a network mismatch rather than sending to an unexpected chain.
- **Lace cannot prove:** confirm the proof server is running on port 6300 and reachable from the browser. Check the proof-server URL in the selected network configuration.
- **1AM cannot prove:** update the wallet and confirm its connector exposes `getProvingProvider`; otherwise configure a compatible local proof server.
- **Deployment fails for funds:** obtain the network's test tokens and confirm the account has both the native balance and the required transaction fee asset.
- **An existing match cannot open:** verify the contract address, network, opponent public key, and matching encrypted private-state backup.
- **A backup will not restore:** use the exact backup password, the same network, and the same contract context. Do not edit the encrypted JSON.
- **The UI shows rehearsal:** the page is intentionally local until a wallet is connected and a live contract is created or joined.

## Current scope and next improvements

The shipped scope is one two-player match with a small board and a complete commit/reveal/resolve lifecycle. Matchmaking, invitations, server-side lobby discovery, spectator/replay mode, tournaments, rankings, chat, automatic timeout arbitration, and richer troop-position modeling are not represented as complete features.

The next high-value additions are:

1. a match registry and invitation flow;
2. explicit block-height timeout arbitration;
3. a public replay/event timeline;
4. testkit-backed local E2E coverage for two real wallets;
5. contract versioning and migration tooling;
6. accessibility review with keyboard-only play and screen-reader announcements for transaction state;
7. observability for proof-server health and indexer lag without collecting private state.

## Security notes

- Do not commit `.env.local`, wallet secrets, backups, generated private keys, or backup passwords.
- Treat the browser profile that holds the local unlock key as sensitive.
- Export an encrypted backup before clearing site data or changing devices.
- Run a proof server you control when privacy and availability matter.
- Treat contract addresses and public transaction IDs as public data.
- Review and test Compact changes before deploying a new contract; existing contracts are not upgraded by rebuilding the frontend.
- Do not describe rehearsal logs as on-chain results.

## Midnight documentation used

The integration follows Midnight's official DApp Connector, network, proving, private-state, and deployment guidance. The repository's local Midnight documentation mirror was used during implementation, and the public network guide is linked above so operators can verify endpoint and environment details before a deployment.
