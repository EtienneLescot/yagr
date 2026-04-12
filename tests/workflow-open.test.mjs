import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempRoots = [];

function makeTempHome(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of tempRoots) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveManagedN8nWorkflowOpen uses local owner credentials when configured host is tunnelized', async () => {
  const home = makeTempHome('yagr-workflow-open-');
  process.env.YAGR_HOME = home;
  process.env.YAGR_LAUNCH_CWD = home;

  fs.mkdirSync(path.join(home, 'n8n'), { recursive: true });
  fs.mkdirSync(path.join(home, 'n8n-workspace'), { recursive: true });

  fs.writeFileSync(path.join(home, 'n8n-workspace', 'n8nac-config.json'), JSON.stringify({
    host: 'https://entered-gig-institution-tennessee.trycloudflare.com',
  }, null, 2));

  const { ManagedN8nOwnerCredentialService } = await import(`../dist/n8n-local/owner-credentials.js?test=${Date.now()}`);
  new ManagedN8nOwnerCredentialService().save({
    url: 'http://127.0.0.1:5678',
    email: 'owner@example.com',
    password: 'secret',
    firstName: 'Owner',
    lastName: 'Local',
    createdAt: new Date().toISOString(),
  });

  fs.writeFileSync(path.join(home, 'n8n-tunnel-state.json'), JSON.stringify({
    publicUrl: 'https://entered-gig-institution-tennessee.trycloudflare.com',
    targetUrl: 'http://127.0.0.1:5678',
    pid: process.pid,
    startedAt: new Date().toISOString(),
  }, null, 2));

  const { resolveManagedN8nWorkflowOpen } = await import(`../dist/n8n-local/workflow-open.js?test=${Date.now()}`);
  const result = resolveManagedN8nWorkflowOpen('https://entered-gig-institution-tennessee.trycloudflare.com/workflow/wf-123');

  assert.equal(result.ok, true);
  assert.equal(result.payload.mode, 'managed');
  assert.equal(result.payload.targetUrl, 'https://entered-gig-institution-tennessee.trycloudflare.com/workflow/wf-123');
});
