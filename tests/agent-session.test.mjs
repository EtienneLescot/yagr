import assert from 'node:assert/strict';
import test from 'node:test';

import { YagrAgent } from '../dist/agent.js';

function createStubEngine() {
  return {
    name: 'n8n',
    async searchNodes() { return []; },
    async nodeInfo() { return {}; },
    async searchTemplates() { return []; },
    async generateWorkflow() { throw new Error('not used'); },
    async validate() { throw new Error('not used'); },
    async deploy() { throw new Error('not used'); },
    async listWorkflows() { return []; },
    async activateWorkflow() {},
    async deactivateWorkflow() {},
    async deleteWorkflow() {},
  };
}

function createBaseRunResult() {
  return {
    runId: 'run-1',
    text: 'done',
    finishReason: 'stop',
    steps: 1,
    toolCalls: [],
    completionAccepted: true,
    requiredActions: [],
    compactions: [],
    finalState: 'completed',
    finalPhase: 'summarize',
    journal: [],
  };
}

test('agent reseeds the prompt snapshot before a run when instructions drift between sessions', async () => {
  let currentSnapshot = { systemPrompt: 'prompt-A', workspaceInstructions: { fingerprint: 'fingerprint-A' } };
  const runnerCalls = [];

  const agent = new YagrAgent(createStubEngine(), {
    buildPromptSnapshot: () => currentSnapshot,
    createRunner: (_engine, history, systemPrompt) => ({
      async execute() {
        runnerCalls.push({ historyLength: history.length, systemPrompt });
        return {
          result: createBaseRunResult(),
          persistedMessages: [{ role: 'assistant', content: 'first reply' }],
          workspaceInstructionsMayHaveChanged: false,
        };
      },
    }),
  });

  await agent.run('first');
  currentSnapshot = { systemPrompt: 'prompt-B', workspaceInstructions: { fingerprint: 'fingerprint-B' } };
  await agent.run('second');

  assert.deepEqual(runnerCalls, [
    { historyLength: 0, systemPrompt: 'prompt-A' },
    { historyLength: 0, systemPrompt: 'prompt-B' },
  ]);
});

test('agent invalidates remembered conversation after update-ai changes workspace instructions', async () => {
  let currentSnapshot = { systemPrompt: 'prompt-A', workspaceInstructions: { fingerprint: 'fingerprint-A' } };
  const runnerCalls = [];
  let runNumber = 0;

  const agent = new YagrAgent(createStubEngine(), {
    buildPromptSnapshot: () => currentSnapshot,
    createRunner: (_engine, history, systemPrompt) => ({
      async execute() {
        runNumber += 1;
        runnerCalls.push({ historyLength: history.length, systemPrompt });

        if (runNumber === 1) {
          currentSnapshot = { systemPrompt: 'prompt-B', workspaceInstructions: { fingerprint: 'fingerprint-B' } };
          return {
            result: createBaseRunResult(),
            persistedMessages: [{ role: 'assistant', content: 'reply before refresh' }],
            workspaceInstructionsMayHaveChanged: true,
          };
        }

        return {
          result: createBaseRunResult(),
          persistedMessages: [{ role: 'assistant', content: 'reply after refresh' }],
          workspaceInstructionsMayHaveChanged: false,
        };
      },
    }),
  });

  const firstResult = await agent.run('refresh instructions');
  await agent.run('next run');

  assert.equal(firstResult.sessionInvalidated, true);
  assert.match(firstResult.sessionInvalidationReason, /Workspace instructions changed during the run/i);
  assert.deepEqual(runnerCalls, [
    { historyLength: 0, systemPrompt: 'prompt-A' },
    { historyLength: 0, systemPrompt: 'prompt-B' },
  ]);
});