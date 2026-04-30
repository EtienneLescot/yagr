import assert from 'node:assert/strict';
import test from 'node:test';

import { isYagrGatewayCommandLine } from '../dist/config/gateway-daemon.js';

test('isYagrGatewayCommandLine recognizes Yagr gateway processes', () => {
  assert.equal(
    isYagrGatewayCommandLine('node /home/user/repos/yagr/dist/cli.js gateway start'),
    true,
  );
  assert.equal(
    isYagrGatewayCommandLine('node /home/user/repos/yagr/dist/cli.js gateway worker'),
    true,
  );
  assert.equal(
    isYagrGatewayCommandLine('"C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@yagr\\agent\\dist\\cli.js" gateway start'),
    true,
  );
});

test('isYagrGatewayCommandLine rejects unrelated or non-gateway processes', () => {
  assert.equal(
    isYagrGatewayCommandLine('node /home/user/repos/yagr/dist/cli.js paths'),
    false,
  );
  assert.equal(
    isYagrGatewayCommandLine('node /home/user/repos/other/dist/cli.js gateway start'),
    false,
  );
});
