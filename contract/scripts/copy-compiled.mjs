import { cp, mkdir, copyFile } from 'node:fs/promises';

await mkdir('./dist', { recursive: true });
await cp('./src/managed', './dist/managed', { recursive: true });
await copyFile('./src/shadowarena.compact', './dist/shadowarena.compact');
