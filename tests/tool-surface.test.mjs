import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTools } from '../dist/tools/build-tools.js';

test('runtime tool surface includes structured discovery tools', () => {
  const engine = {
    name: 'n8n',
    searchNodes: async () => [],
    nodeInfo: async () => ({}),
    searchTemplates: async () => [],
    generateWorkflow: async () => ({ engine: 'n8n', name: 'x', sourceType: 'n8n-json', definition: {}, credentialRequirements: [] }),
    validate: async () => ({ valid: true, errors: [], warnings: [] }),
    deploy: async () => ({ id: '1', engine: 'n8n', name: 'x', active: false, credentialRequirements: [] }),
    listWorkflows: async () => [],
    activateWorkflow: async () => {},
    deactivateWorkflow: async () => {},
    deleteWorkflow: async () => {},
  };

  const tools = buildTools(engine);

  assert.ok(tools.searchNodes);
  assert.ok(tools.nodeInfo);
  assert.ok(tools.searchTemplates);
});

test('runtime tool surface can be reduced to a strategy-selected subset', () => {
  const engine = {
    name: 'n8n',
    searchNodes: async () => [],
    nodeInfo: async () => ({}),
    searchTemplates: async () => [],
    generateWorkflow: async () => ({ engine: 'n8n', name: 'x', sourceType: 'n8n-json', definition: {}, credentialRequirements: [] }),
    validate: async () => ({ valid: true, errors: [], warnings: [] }),
    deploy: async () => ({ id: '1', engine: 'n8n', name: 'x', active: false, credentialRequirements: [] }),
    listWorkflows: async () => [],
    activateWorkflow: async () => {},
    deactivateWorkflow: async () => {},
    deleteWorkflow: async () => {},
  };

  const tools = buildTools(engine, undefined, {
    allowedToolNames: ['reportProgress', 'requestRequiredAction', 'presentWorkflowResult'],
  });

  assert.deepEqual(Object.keys(tools).sort(), ['presentWorkflowResult', 'reportProgress', 'requestRequiredAction']);
});
