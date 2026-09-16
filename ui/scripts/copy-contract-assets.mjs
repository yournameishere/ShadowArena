import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(here, '..');
const sourceCandidates = [
  resolve(uiRoot, '..', 'contract', 'src', 'managed', 'shadowarena'),
  resolve(uiRoot, '..', 'contract', 'dist', 'managed', 'shadowarena'),
];
const source = sourceCandidates.find((candidate) => existsSync(candidate));
const destination = resolve(uiRoot, 'public');

if (!source) {
  throw new Error('Contract proving assets are missing. Run `npm run compact` and `npm run build --workspace @shadowarena/contract` first.');
}

await mkdir(destination, { recursive: true });
for (const folder of ['compiler', 'keys', 'zkir']) {
  const from = resolve(source, folder);
  const to = resolve(destination, folder);
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
}

console.log(`Copied Midnight proving assets from ${source}`);
