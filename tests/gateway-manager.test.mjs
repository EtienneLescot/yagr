import assert from 'node:assert/strict';
import test from 'node:test';

import { getGatewayRestartDelayMs } from '../dist/cli.js';
import { normalizeGatewaySurfaces } from '../dist/config/yagr-config-service.js';
import { buildGatewaySupervisorStatus } from '../dist/gateway/manager.js';

test('normalizeGatewaySurfaces keeps supported surfaces once', () => {
  assert.deepEqual(
    normalizeGatewaySurfaces(['telegram', 'webui', 'telegram', 'unknown', 'whatsapp']),
    ['telegram', 'webui', 'whatsapp'],
  );
});

test('buildGatewaySupervisorStatus exposes startable surfaces and warnings', () => {
  const status = buildGatewaySupervisorStatus([
    {
      id: 'telegram',
      label: 'Telegram',
      enabled: true,
      configured: true,
      implemented: true,
      summary: '@yagr, 0 linked chats',
    },
    {
      id: 'webui',
      label: 'Web UI',
      enabled: true,
      configured: false,
      implemented: false,
      summary: 'Not implemented yet',
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      enabled: false,
      configured: false,
      implemented: false,
      summary: 'Not implemented yet',
    },
  ]);

  assert.deepEqual(status.enabledSurfaces, ['telegram', 'webui']);
  assert.deepEqual(status.startableSurfaces, ['telegram']);
  assert.equal(status.surfaces[0].startable, true);
  assert.equal(status.surfaces[1].startable, false);
  assert.deepEqual(status.warnings, ['Web UI is enabled but not implemented yet.']);
});

test('getGatewayRestartDelayMs uses capped exponential backoff', () => {
  assert.equal(getGatewayRestartDelayMs(0), 1_000);
  assert.equal(getGatewayRestartDelayMs(1), 2_000);
  assert.equal(getGatewayRestartDelayMs(2), 4_000);
  assert.equal(getGatewayRestartDelayMs(6), 30_000);
  assert.equal(getGatewayRestartDelayMs(20), 30_000);
});
