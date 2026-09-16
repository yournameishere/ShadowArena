import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Buffer } from 'buffer';
import App from './App';

// Midnight's browser bundle includes dependencies that use the Node Buffer API.
// Expose the browser-safe implementation before React or the live chain chunk loads.
const browserGlobal = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
browserGlobal.Buffer ??= Buffer;

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
