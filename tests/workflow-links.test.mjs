import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { YagrConfigService } from '../dist/config/yagr-config-service.js';
import { ManagedN8nOwnerCredentialService } from '../dist/n8n-local/owner-credentials.js';
import { resolveWorkflowOpenLink } from '../dist/gateway/workflow-links.js';

test('resolveWorkflowOpenLink returns direct URL when no managed local credentials are stored', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-workflow-link-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const result = resolveWorkflowOpenLink('http://127.0.0.1:5678/workflow/abc');
    assert.deepEqual(result, {
      openUrl: 'http://127.0.0.1:5678/workflow/abc',
      targetUrl: 'http://127.0.0.1:5678/workflow/abc',
      via: 'direct',
    });
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('resolveWorkflowOpenLink uses a self-contained auth bridge for managed local n8n', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-workflow-link-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const configService = new YagrConfigService();
    configService.saveLocalConfig({});

    const ownerCredentialService = new ManagedN8nOwnerCredentialService();
    ownerCredentialService.save({
      url: 'http://127.0.0.1:5678',
      email: 'owner@local.yagr',
      password: 'Password1A',
      firstName: 'Yagr',
      lastName: 'Local',
      createdAt: new Date().toISOString(),
    });

    const result = resolveWorkflowOpenLink('http://127.0.0.1:5678/workflow/abc', {
      configService,
      ownerCredentialService,
    });

    assert.equal(result.via, 'self-contained-auth');
    assert.equal(result.targetUrl, 'http://127.0.0.1:5678/workflow/abc');
    assert.match(result.openUrl, /^data:text\/html;charset=utf-8,/);
    assert.match(decodeURIComponent(result.openUrl), /http:\/\/127\.0\.0\.1:5678\/workflow\/abc/);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
