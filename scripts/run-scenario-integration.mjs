#!/usr/bin/env node
import process from 'node:process';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const env = { ...process.env };
const passthroughArgs = [];

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  const next = argv[i + 1];
  if ((arg === '--provider' || arg === '--model' || arg === '--scenario' || arg === '--scenarios') && next) {
    if (arg === '--provider') env.YAGR_SCN_PROVIDER = next;
    if (arg === '--model') env.YAGR_SCN_MODEL = next;
    if (arg === '--scenario' || arg === '--scenarios') env.YAGR_SCN_SCENARIOS = next;
    i += 1;
    continue;
  }
  if (arg === '--debug') {
    env.YAGR_SCN_DEBUG = '1';
    continue;
  }
  if (arg === '--keep-temp') {
    env.YAGR_SCN_KEEP_TEMP = '1';
    continue;
  }
  if (arg === '--no-markdown') {
    env.YAGR_SCN_NO_MARKDOWN = '1';
    continue;
  }
  passthroughArgs.push(arg);
}

const child = spawn(process.execPath, ['--test', 'scripts/scenario-integration-test.mjs', ...passthroughArgs], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});