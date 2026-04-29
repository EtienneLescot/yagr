import assert from 'node:assert/strict';
import test from 'node:test';

import {
  escapeHtml,
  formatTerminalLink,
  markdownToTelegramHtml,
} from '../dist/gateway/format-message.js';

test('escapeHtml escapes ampersand and angle brackets', () => {
  assert.equal(escapeHtml('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
});

test('formatTerminalLink produces an OSC 8 alias link', () => {
  const result = formatTerminalLink('click here', 'https://example.com');
  assert.ok(result.includes('\x1b]8;;https://example.com\x07'));
  assert.ok(result.includes('click here'));
  assert.ok(result.includes('\x1b]8;;\x07'));
});

test('markdownToTelegramHtml converts basic markdown to Telegram-compatible HTML', () => {
  const html = markdownToTelegramHtml('# Title\n\n- **Bold** and `code`');
  assert.match(html, /<b>Title<\/b>/);
  assert.match(html, /<b>Bold<\/b>/);
  assert.match(html, /<code>code<\/code>/);
});
