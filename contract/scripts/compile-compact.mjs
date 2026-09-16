import { spawnSync } from 'node:child_process';

const root = process.cwd();
const input = 'src/shadowarena.compact';
const output = 'src/managed/shadowarena';
const compilerVersion = process.env.COMPACT_VERSION ?? '0.31.1';
if (!/^\d+\.\d+\.\d+$/.test(compilerVersion)) throw new Error('COMPACT_VERSION must be a full semantic version such as 0.31.1');
const shellQuote = (value) => `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
const compileArgs = ['compile', `+${compilerVersion}`, input, output];

const result = process.platform === 'win32'
  ? spawnSync('wsl', ['bash', '-lc', `cd ${shellQuote(root.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/'))} && rm -rf -- ${shellQuote(output)} && compact compile +${compilerVersion} ${shellQuote(input)} ${shellQuote(output)}`], { stdio: 'inherit' })
  : spawnSync('compact', compileArgs, { cwd: root, stdio: 'inherit' });

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
