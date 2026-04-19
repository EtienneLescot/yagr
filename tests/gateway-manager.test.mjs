import assert from 'node:assert/strict';
import test from 'node:test';

import { getGatewayRestartDelayMs } from '../dist/cli.js';
import { normalizeGatewaySurfaces } from '../dist/config/yagr-config-service.js';
import {
  buildGatewaySupervisorStatus,
  stopGatewayRuntimes,
} from '../dist/gateway/manager.js';

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
  assert.equal(getGatewayRestartDelayMs(0), 60_000);
  assert.equal(getGatewayRestartDelayMs(1), 120_000);
  assert.equal(getGatewayRestartDelayMs(2), 240_000);
  assert.equal(getGatewayRestartDelayMs(6), 300_000);
  assert.equal(getGatewayRestartDelayMs(20), 300_000);
});

test('stopGatewayRuntimes only stops facade runtimes and tolerates stop failures', async () => {
  const stopped = [];
  const runtimes = [
    {
      gateway: {
        async start() {},
        async stop() {
          stopped.push('webui');
        },
        async reply() {},
      },
      startupMessages: [],
    },
    {
      gateway: {
        async start() {},
        async stop() {
          stopped.push('telegram');
          throw new Error('simulated stop failure');
        },
        async reply() {},
      },
      startupMessages: [],
    },
  ];

  await assert.doesNotReject(() => stopGatewayRuntimes(runtimes));
  assert.deepEqual(stopped.sort(), ['telegram', 'webui']);
});
