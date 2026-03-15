import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const testWorkspace = join(repoRoot, '.holon-test-workspace');

function ensureTestWorkspace() {
  mkdirSync(testWorkspace, { recursive: true });
}

function runNodeScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: testWorkspace,
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command exited with code ${code ?? 1}`));
    });
  });
}

async function main() {
  ensureTestWorkspace();

  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'pwd': {
      process.stdout.write(`${testWorkspace}\n`);
      return;
    }

    case 'init': {
      const cliEntry = join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
      await runNodeScript(cliEntry, ['init', ...args]);
      return;
    }

    case 'agent': {
      const agentEntry = join(repoRoot, 'packages', 'agent', 'dist', 'cli.js');
      await runNodeScript(agentEntry, args);
      return;
    }

    default: {
      process.stderr.write(
        'Usage:\n' +
          '  npm run holon:test:workspace\n' +
          '  npm run holon:test:init -- [init args]\n' +
          '  npm run holon:test:agent -- [agent args]\n',
      );
      process.exit(1);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`holon-test-workspace error: ${message}\n`);
  process.exit(1);
});