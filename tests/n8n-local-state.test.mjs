import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildManagedN8nState,
  markManagedN8nBootstrapStage,
  readManagedN8nState,
  writeManagedN8nState,
} from '../dist/n8n-local/state.js';

test('markManagedN8nBootstrapStage updates the managed instance state for the matching URL', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-state-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const state = buildManagedN8nState({
      image: 'docker.n8n.io/n8nio/n8n:stable',
      port: 5678,
      status: 'ready',
      bootstrapStage: 'owner-pending',
    });
    writeManagedN8nState(state);

    const next = markManagedN8nBootstrapStage(state.url, 'connected');
    assert.equal(next?.bootstrapStage, 'connected');
    assert.equal(readManagedN8nState()?.bootstrapStage, 'connected');
  } finally {
    if (previousHome !== undefined) {
      process.env.YAGR_HOME = previousHome;
    } else {
      delete process.env.YAGR_HOME;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
