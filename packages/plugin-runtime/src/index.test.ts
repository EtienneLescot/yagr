import test from 'node:test';
import assert from 'node:assert/strict';

import { defineYagrPlugin, YagrPluginRegistry } from './index.js';

test('plugin registry stores registered plugins and rejects duplicates', () => {
  const registry = new YagrPluginRegistry();
  const plugin = defineYagrPlugin({
    manifest: {
      name: '@yagr/plugin-test',
      version: '0.1.0',
      kind: 'integration',
      description: 'Test plugin',
    },
  });

  registry.register(plugin);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.get('@yagr/plugin-test')?.manifest.name, '@yagr/plugin-test');
  assert.throws(() => registry.register(plugin), /Plugin already registered/);
});
