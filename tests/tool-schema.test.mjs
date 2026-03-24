import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeFunctionToolParametersSchema } from '../dist/llm/tool-schema.js';

test('normalizeFunctionToolParametersSchema makes optional object properties required and nullable for strict providers', () => {
  const normalized = normalizeFunctionToolParametersSchema({
    type: 'object',
    properties: {
      kind: { type: 'string' },
      detail: { type: 'string' },
      resumable: { type: 'boolean' },
    },
    required: ['kind'],
    additionalProperties: false,
  }, {
    forceRequiredObjectProperties: true,
  });

  assert.deepEqual(normalized.required, ['kind', 'detail', 'resumable']);
  assert.deepEqual(normalized.properties.detail.type, ['string', 'null']);
  assert.deepEqual(normalized.properties.resumable.type, ['boolean', 'null']);
});

test('normalizeFunctionToolParametersSchema preserves already required properties', () => {
  const normalized = normalizeFunctionToolParametersSchema({
    type: 'object',
    properties: {
      action: { type: 'string' },
    },
    required: ['action'],
  }, {
    forceRequiredObjectProperties: true,
  });

  assert.deepEqual(normalized.required, ['action']);
  assert.equal(normalized.properties.action.type, 'string');
  assert.equal(normalized.additionalProperties, false);
});

