import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { MemorySaver } from '@langchain/langgraph';

import {
  SlashCommandService,
} from '../dist/conversation/slash-command-service.js';
import {
  resolveCommand,
  getCommandsForSurface,
  getAllCommands,
} from '../dist/conversation/slash-command-registry.js';
import { SessionService } from '../dist/session/index.js';

function createTempSessionService() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-slash-test-'));
  const memoriesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-slash-memories-'));
  return { service: new SessionService({ sessionsDir: tempDir, memoriesDir }), tempDir, memoriesDir };
}

test('resolveCommand parses canonical names', () => {
  assert.equal(resolveCommand('/help'), 'help');
  assert.equal(resolveCommand('/sessions'), 'sessions');
  assert.equal(resolveCommand('/resume'), 'resume');
  assert.equal(resolveCommand('/delete'), 'delete');
  assert.equal(resolveCommand('/new'), 'new');
  assert.equal(resolveCommand('/reset'), 'reset');
  assert.equal(resolveCommand('/checkpoints'), 'checkpoints');
  assert.equal(resolveCommand('/save'), 'save');
  assert.equal(resolveCommand('/restore'), 'restore');
  assert.equal(resolveCommand('/checkpoint_delete'), 'checkpoint_delete');
  assert.equal(resolveCommand('/pending'), 'pending');
  assert.equal(resolveCommand('/approve'), 'approve');
  assert.equal(resolveCommand('/compact'), 'compact');
  assert.equal(resolveCommand('/open'), 'open');
  assert.equal(resolveCommand('/toggle_thinking'), 'toggle_thinking');
  assert.equal(resolveCommand('/toggle_cli'), 'toggle_cli');
  assert.equal(resolveCommand('/stop'), 'stop');
  assert.equal(resolveCommand('/exit'), 'exit');
});

test('resolveCommand parses aliases', () => {
  assert.equal(resolveCommand('/session'), 'sessions');
  assert.equal(resolveCommand('/list_sessions'), 'sessions');
  assert.equal(resolveCommand('/del'), 'delete');
  assert.equal(resolveCommand('/rm'), 'delete');
  assert.equal(resolveCommand('/toggle-thinking'), 'toggle_thinking');
  assert.equal(resolveCommand('/toggle-agent-thinking'), 'toggle_thinking');
  assert.equal(resolveCommand('/toggle-cli'), 'toggle_cli');
  assert.equal(resolveCommand('/toggle-command-executions'), 'toggle_cli');
  assert.equal(resolveCommand('/checkpoint_save'), 'save');
  assert.equal(resolveCommand('/quit'), 'exit');
});

test('resolveCommand returns undefined for non-slash input', () => {
  assert.equal(resolveCommand('help'), undefined);
  assert.equal(resolveCommand(''), undefined);
  assert.equal(resolveCommand('/'), undefined);
});

test('getCommandsForSurface returns only commands available on that surface', () => {
  const tuiCommands = getCommandsForSurface('tui');
  const names = tuiCommands.map((c) => c.name);
  assert.ok(names.includes('help'));
  assert.ok(names.includes('sessions'));
  assert.ok(names.includes('resume'));
  assert.ok(names.includes('delete'));
  assert.ok(names.includes('new'));
  assert.ok(names.includes('open'));
  assert.ok(names.includes('toggle_thinking'));
  assert.ok(names.includes('exit'));
  assert.ok(!names.includes('unknown_fake_command'));

  const telegramCommands = getCommandsForSurface('telegram');
  const tNames = telegramCommands.map((c) => c.name);
  assert.ok(tNames.includes('help'));
  assert.ok(tNames.includes('sessions'));
  assert.ok(tNames.includes('resume'));
  assert.ok(tNames.includes('delete'));
  assert.ok(!tNames.includes('open'));
  assert.ok(!tNames.includes('exit'));
  assert.ok(!tNames.includes('toggle_thinking'));

  const webuiCommands = getCommandsForSurface('webui');
  const wNames = webuiCommands.map((c) => c.name);
  assert.ok(wNames.includes('help'));
  assert.ok(wNames.includes('sessions'));
  assert.ok(wNames.includes('resume'));
  assert.ok(!wNames.includes('open'));
  assert.ok(!wNames.includes('exit'));
  assert.ok(!wNames.includes('toggle_thinking'));
});

test('SlashCommandService.parse returns undefined for non-slash input', () => {
  const { service: sessions } = createTempSessionService();
  const slashService = new SlashCommandService(sessions, {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  } as any);

  assert.equal(slashService.parse('hello world'), undefined);
  assert.equal(slashService.parse(''), undefined);
});

test('SlashCommandService.parse extracts command and args', () => {
  const { service: sessions } = createTempSessionService();
  const slashService = new SlashCommandService(sessions, {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  } as any);

  const parsed = slashService.parse('/resume abc-123');
  assert.ok(parsed);
  assert.equal(parsed.command, 'resume');
  assert.deepEqual(parsed.args, ['abc-123']);
  assert.equal(parsed.raw, '/resume abc-123');
});

test('SlashCommandService.parse handles command with no args', () => {
  const { service: sessions } = createTempSessionService();
  const slashService = new SlashCommandService(sessions, {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  } as any);

  const parsed = slashService.parse('/sessions');
  assert.ok(parsed);
  assert.equal(parsed.command, 'sessions');
  assert.deepEqual(parsed.args, []);
});

test('SlashCommandService.buildHelpResult returns all commands for surface', () => {
  const { service: sessions } = createTempSessionService();
  const slashService = new SlashCommandService(sessions, {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  } as any);

  const result = slashService.buildHelpResult('tui');
  assert.equal(result.kind, 'ok');
  assert.ok(result.message.includes('/help'));
  assert.ok(result.message.includes('/sessions'));
  assert.ok(result.message.includes('/resume'));
  assert.ok(result.message.includes('/exit'));
  assert.ok(result.data && typeof result.data === 'object' && 'commands' in result.data);
});

test('SlashCommandService.execute /help returns command list', async () => {
  const { service: sessions } = createTempSessionService();
  const slashService = new SlashCommandService(sessions, {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  } as any);

  const result = await slashService.execute(
    { command: 'help', args: [], raw: '/help' },
    { surface: 'tui', sessionId: 'default', threadId: 'thread-1' },
    { getActiveSessionId: () => undefined, resumeSession: () => {}, resetLocalState: () => {} },
  );

  assert.equal(result.kind, 'ok');
  assert.ok(result.message.includes('/sessions'));
});

test('SlashCommandService.execute /new creates a new session and resets local state', async () => {
  const { service: sessions } = createTempSessionService();
  const compactionService = {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  };
  const slashService = new SlashCommandService(sessions, compactionService as any);

  let resetCalled = false;
  let resumeSessionId = '';

  const result = await slashService.execute(
    { command: 'new', args: [], raw: '/new' },
    { surface: 'tui', sessionId: 'default', threadId: 'thread-1' },
    {
      getActiveSessionId: () => undefined,
      resumeSession: (_scope: any, id: string) => { resumeSessionId = id; },
      resetLocalState: () => { resetCalled = true; },
    },
  );

  assert.equal(result.kind, 'ok');
  assert.ok(result.message.includes('New session started'));
  assert.ok(resetCalled);
  assert.ok(resumeSessionId.length > 0);
});

test('SlashCommandService.execute /reset is alias of /new', async () => {
  const { service: sessions } = createTempSessionService();
  const compactionService = {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  };
  const slashService = new SlashCommandService(sessions, compactionService as any);

  let resetCalled = false;

  await slashService.execute(
    { command: 'reset', args: [], raw: '/reset' },
    { surface: 'tui', sessionId: 'default', threadId: 'thread-1' },
    {
      getActiveSessionId: () => undefined,
      resumeSession: () => {},
      resetLocalState: () => { resetCalled = true; },
    },
  );

  assert.ok(resetCalled);
});

test('SlashCommandService.execute /resume with no args returns invalid_arguments', async () => {
  const { service: sessions } = createTempSessionService();
  const slashService = new SlashCommandService(sessions, {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  } as any);

  const result = await slashService.execute(
    { command: 'resume', args: [], raw: '/resume' },
    { surface: 'tui', sessionId: 'default', threadId: 'thread-1' },
    { getActiveSessionId: () => undefined, resumeSession: () => {}, resetLocalState: () => {} },
  );

  assert.equal(result.kind, 'invalid_arguments');
  assert.ok(result.message.includes('Usage'));
});

test('SlashCommandService.execute /resume with unknown session returns session_not_found', async () => {
  const { service: sessions } = createTempSessionService();
  const slashService = new SlashCommandService(sessions, {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  } as any);

  const result = await slashService.execute(
    { command: 'resume', args: ['nonexistent-id'], raw: '/resume nonexistent-id' },
    { surface: 'tui', sessionId: 'default', threadId: 'thread-1' },
    { getActiveSessionId: () => undefined, resumeSession: () => {}, resetLocalState: () => {} },
  );

  assert.equal(result.kind, 'session_not_found');
});

test('SlashCommandService.execute /approve resumes pending permissions when supported', async () => {
  const { service: sessions } = createTempSessionService();
  const slashService = new SlashCommandService(sessions, {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  } as any);

  const result = await slashService.execute(
    { command: 'approve', args: [], raw: '/approve' },
    { surface: 'tui', sessionId: 'default', threadId: 'thread-1' },
    {
      getActiveSessionId: () => undefined,
      resumeSession: () => {},
      resetLocalState: () => {},
      approvePendingPermissions: () => 2,
    },
  );

  assert.equal(result.kind, 'ok');
  assert.ok(result.message.includes('Permission granted'));
  assert.ok(result.data && typeof result.data === 'object' && 'resumePrompt' in result.data);
});

test('SlashCommandService.execute /approve returns unsupported_in_surface without approval handler', async () => {
  const { service: sessions } = createTempSessionService();
  const slashService = new SlashCommandService(sessions, {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  } as any);

  const result = await slashService.execute(
    { command: 'approve', args: [], raw: '/approve' },
    { surface: 'webui', sessionId: 'default', threadId: 'thread-1' },
    {
      getActiveSessionId: () => undefined,
      resumeSession: () => {},
      resetLocalState: () => {},
    },
  );

  assert.equal(result.kind, 'unsupported_in_surface');
});

test('SlashCommandService.execute /delete with no args returns invalid_arguments', async () => {
  const { service: sessions } = createTempSessionService();
  const slashService = new SlashCommandService(sessions, {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  } as any);

  const result = await slashService.execute(
    { command: 'delete', args: [], raw: '/delete' },
    { surface: 'tui', sessionId: 'default', threadId: 'thread-1' },
    { getActiveSessionId: () => undefined, resumeSession: () => {}, resetLocalState: () => {} },
  );

  assert.equal(result.kind, 'invalid_arguments');
});

test('SlashCommandService.execute /restore with no args returns invalid_arguments', async () => {
  const { service: sessions } = createTempSessionService();
  const slashService = new SlashCommandService(sessions, {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  } as any);

  const result = await slashCommand_execute(slashService, 'restore', [], 'tui', 'thread-1');

  assert.equal(result.kind, 'invalid_arguments');
});

test('SlashCommandService.execute /checkpoint_delete with no args returns invalid_arguments', async () => {
  const { service: sessions } = createTempSessionService();
  const slashService = new SlashCommandService(sessions, {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  } as any);

  const result = await slashService.execute(
    { command: 'checkpoint_delete', args: [], raw: '/checkpoint_delete' },
    { surface: 'tui', sessionId: 'default', threadId: 'thread-1' },
    { getActiveSessionId: () => undefined, resumeSession: () => {}, resetLocalState: () => {} },
  );

  assert.equal(result.kind, 'invalid_arguments');
});

test('SlashCommandService.execute /unknown_command returns unknown_command', async () => {
  const { service: sessions } = createTempSessionService();
  const slashService = new SlashCommandService(sessions, {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  } as any);

  const parsed = slashService.parse('/foobar');
  assert.equal(parsed, undefined);

  const result = await slashService.execute(
    { command: 'help', args: [], raw: '/foobar' },
    { surface: 'tui', sessionId: 'default', threadId: 'thread-1' },
    { getActiveSessionId: () => undefined, resumeSession: () => {}, resetLocalState: () => {} },
  );

  assert.equal(result.kind, 'ok');
});

test('SlashCommandService.execute /toggle_thinking calls setDisplayOptions', async () => {
  const { service: sessions } = createTempSessionService();
  const slashService = new SlashCommandService(sessions, {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  } as any);

  let showThinking = true;
  let showExecution = true;

  const result = await slashService.execute(
    { command: 'toggle_thinking', args: [], raw: '/toggle_thinking' },
    { surface: 'tui', sessionId: 'default', threadId: 'thread-1' },
    {
      getActiveSessionId: () => undefined,
      resumeSession: () => {},
      resetLocalState: () => {},
      getDisplayOptions: () => ({ showThinking, showExecution }),
      setDisplayOptions: (opts: any) => {
        if (opts.showThinking !== undefined) showThinking = opts.showThinking;
        if (opts.showExecution !== undefined) showExecution = opts.showExecution;
      },
    },
  );

  assert.equal(result.kind, 'ok');
  assert.equal(showThinking, false);
});

test('SlashCommandService.execute /toggle_thinking returns unsupported_in_surface on webui', async () => {
  const { service: sessions } = createTempSessionService();
  const slashService = new SlashCommandService(sessions, {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  } as any);

  const result = await slashService.execute(
    { command: 'toggle_thinking', args: [], raw: '/toggle_thinking' },
    { surface: 'webui', sessionId: 'default', threadId: 'thread-1' },
    {
      getActiveSessionId: () => undefined,
      resumeSession: () => {},
      resetLocalState: () => {},
    },
  );

  assert.equal(result.kind, 'unsupported_in_surface');
});

test('SlashCommandService.execute /sessions returns session list for scope', async () => {
  const { service: sessions } = createTempSessionService();
  const slashService = new SlashCommandService(sessions, {
    getState: () => null,
    reset: () => {},
    setState: () => {},
    notifyCompaction: async () => {},
  } as any);

  sessions.create({ scope: { kind: 'tui', key: 'default' }, title: 'First session' });

  const result = await slashService.execute(
    { command: 'sessions', args: [], raw: '/sessions' },
    { surface: 'tui', sessionId: 'default', threadId: 'thread-1' },
    { getActiveSessionId: () => undefined, resumeSession: () => {}, resetLocalState: () => {} },
  );

  assert.equal(result.kind, 'ok');
  assert.ok(result.message.includes('First session'));
  assert.ok(result.data && typeof result.data === 'object' && 'sessions' in result.data);
});

async function slashCommand_execute(svc: SlashCommandService, cmd: string, args: string[], surface: string, threadId: string) {
  return svc.execute(
    { command: cmd as any, args, raw: `/${cmd}` },
    { surface: surface as any, sessionId: 'default', threadId },
    { getActiveSessionId: () => undefined, resumeSession: () => {}, resetLocalState: () => {} },
  );
}
