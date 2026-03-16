import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTelegramDeepLink,
  removeLinkedChat,
  splitTelegramMessage,
  upsertLinkedChat,
} from '../dist/gateway/telegram.js';

test('buildTelegramDeepLink creates a Telegram deep link with onboarding token', () => {
  assert.equal(
    buildTelegramDeepLink('holon_bot', 'token-123'),
    'https://t.me/holon_bot?start=token-123',
  );
});

test('upsertLinkedChat updates an existing chat instead of duplicating it', () => {
  const initial = [
    {
      chatId: '42',
      username: 'oldname',
      linkedAt: '2026-03-16T10:00:00.000Z',
    },
  ];

  const updated = upsertLinkedChat(initial, {
    chatId: '42',
    username: 'newname',
    linkedAt: '2026-03-16T10:00:00.000Z',
    lastSeenAt: '2026-03-16T10:05:00.000Z',
  });

  assert.equal(updated.length, 1);
  assert.equal(updated[0].username, 'newname');
  assert.equal(updated[0].lastSeenAt, '2026-03-16T10:05:00.000Z');
});

test('removeLinkedChat removes the requested chat id', () => {
  const remaining = removeLinkedChat([
    { chatId: '1', linkedAt: '2026-03-16T10:00:00.000Z' },
    { chatId: '2', linkedAt: '2026-03-16T10:00:00.000Z' },
  ], '1');

  assert.deepEqual(remaining, [{ chatId: '2', linkedAt: '2026-03-16T10:00:00.000Z' }]);
});

test('splitTelegramMessage keeps chunks under Telegram size limit', () => {
  const text = `${'a'.repeat(3000)}\n\n${'b'.repeat(2500)}`;
  const chunks = splitTelegramMessage(text, 4096);

  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 4096));
  assert.match(chunks[0], /^a+/);
  assert.match(chunks[1], /^b+/);
});