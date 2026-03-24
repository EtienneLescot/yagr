import assert from 'node:assert/strict';
import test from 'node:test';

import { getWebUiGatewayStatus } from '../dist/gateway/webui.js';

test('getWebUiGatewayStatus is a pure read and does not persist defaults', () => {
  let updateCalls = 0;
  const configService = {
    getLocalConfig() {
      return {};
    },
    updateLocalConfig() {
      updateCalls += 1;
      throw new Error('updateLocalConfig should not be called when reading Web UI status');
    },
  };

  const status = getWebUiGatewayStatus(configService);

  assert.deepEqual(status, {
    configured: true,
    host: '127.0.0.1',
    port: 3789,
    url: 'http://127.0.0.1:3789',
  });
  assert.equal(updateCalls, 0);
});
