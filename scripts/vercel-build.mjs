import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

const compactVersion = process.env.COMPACT_VERSION ?? '0.31.1';
const compactHome = join(homedir(), '.compact');
const executableName = process.platform === 'win32' ? 'compact.exe' : 'compact';
const compactBins = [join(compactHome, 'bin'), join(homedir(), '.local', 'bin')];
const buildEnv = { ...process.env, COMPACT_VERSION: compactVersion };
const findCompact = () => compactBins.map((bin) => join(bin, executableName)).find((candidate) => existsSync(candidate));

if (process.platform === 'win32' && !findCompact()) {
  throw new Error('The Vercel build helper is intended for Linux CI. Install Compact locally through WSL before running the normal Windows build.');
}

if (!findCompact()) {
  execFileSync('sh', ['-c', "curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh"], { stdio: 'inherit' });
}

const compactPath = findCompact();
if (!compactPath) throw new Error('Compact installed, but its executable could not be found in ~/.compact/bin or ~/.local/bin.');
buildEnv.PATH = [dirname(compactPath), ...compactBins, process.env.PATH ?? ''].filter(Boolean).join(delimiter);
execFileSync(compactPath, ['update', compactVersion], { stdio: 'inherit', env: buildEnv });

// The lockfile is generated on Windows, while Vercel installs on Linux. npm can
// omit platform-specific optional packages in that cross-platform case, which
// breaks Vite before the app code is even reached. Restore the two native build
// helpers explicitly using the versions already pinned in package-lock.json.
if (process.platform === 'linux') {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const rollupVersion = lock.packages['node_modules/rollup'].version;
  const esbuildVersion = lock.packages['node_modules/esbuild'].version;
  execFileSync('npm', [
    'install', '--no-save', '--ignore-scripts', '--package-lock=false',
    `@rollup/rollup-linux-x64-gnu@${rollupVersion}`,
    `@esbuild/linux-x64@${esbuildVersion}`,
  ], { stdio: 'inherit', env: buildEnv });
}
execFileSync('npm', ['run', 'build'], { stdio: 'inherit', env: buildEnv });
