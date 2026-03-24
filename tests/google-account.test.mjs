import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGeminiUnexpectedToolCallFinishMessage } from '../dist/llm/google-account.js';

test('parseGeminiUnexpectedToolCallFinishMessage parses kwargs-style calls', () => {
  const parsed = parseGeminiUnexpectedToolCallFinishMessage(
    "Unexpected tool call: print(n8nac(action='skills', skillsArgs='search set'))",
  );

  assert.deepEqual(parsed, {
    toolName: 'n8nac',
    args: {
      action: 'skills',
      skillsArgs: 'search set',
    },
  });
});

test('parseGeminiUnexpectedToolCallFinishMessage parses json-like argument payloads', () => {
  const parsed = parseGeminiUnexpectedToolCallFinishMessage(
    'Unexpected tool call: print(reportProgress({"message":"working"}))',
  );

  assert.deepEqual(parsed, {
    toolName: 'reportProgress',
    args: {
      message: 'working',
    },
  });
});
