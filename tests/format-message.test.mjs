import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorkflowFooterHtml,
  buildWorkflowFooterPlain,
  buildWorkflowFooterTerminal,
  escapeHtml,
  extractWorkflowEmbed,
  formatWorkflowLinkHtml,
  formatWorkflowLinkPlain,
  formatWorkflowLinkTerminal,
  markdownToTelegramHtml,
} from '../dist/gateway/format-message.js';
import { enrichWorkflowEmbed } from '../dist/gateway/n8n-workflow-middleware.js';

// ---------------------------------------------------------------------------
// extractWorkflowEmbed
// ---------------------------------------------------------------------------

test('extractWorkflowEmbed returns embed from a workflow embed event', () => {
  const event = {
    type: 'embed',
    toolName: 'presentWorkflowResult',
    kind: 'workflow',
    workflowId: 'abc123',
    url: 'https://n8n.example.com/workflow/abc123',
    title: 'My Workflow',
    diagram: '<workflow-map>\nStart --> Set\n</workflow-map>',
  };
  const embed = extractWorkflowEmbed(event);
  assert.deepEqual(embed, {
    workflowId: 'abc123',
    url: 'https://n8n.example.com/workflow/abc123',
    targetUrl: undefined,
    title: 'My Workflow',
    diagram: '<workflow-map>\nStart --> Set\n</workflow-map>',
    executionResult: undefined,
  });
});

test('extractWorkflowEmbed returns undefined for non-embed events', () => {
  const event = { type: 'status', toolName: 'reportProgress', message: 'working' };
  assert.equal(extractWorkflowEmbed(event), undefined);
});

// ---------------------------------------------------------------------------
// Workflow link formatting
// ---------------------------------------------------------------------------

test('formatWorkflowLinkPlain includes the workflow title', () => {
  const result = formatWorkflowLinkPlain({
    workflowId: 'abc',
    url: 'https://n8n.example.com/workflow/abc',
    title: 'Test WF',
  });
  assert.match(result, /Test WF/);
});

test('formatWorkflowLinkPlain falls back to workflowId when no title', () => {
  const result = formatWorkflowLinkPlain({
    workflowId: 'xyz',
    url: 'https://n8n.example.com/workflow/xyz',
  });
  assert.match(result, /Workflow xyz/);
});

test('formatWorkflowLinkHtml outputs an anchor tag', () => {
  const result = formatWorkflowLinkHtml({
    workflowId: 'abc',
    url: 'https://n8n.example.com/workflow/abc',
    title: 'Test WF',
  });
  assert.match(result, /<a href="https:\/\/n8n\.example\.com\/workflow\/abc">Test WF<\/a>/);
  assert.match(result, /https:\/\/n8n\.example\.com\/workflow\/abc/);
});

test('formatWorkflowLinkHtml escapes HTML in title', () => {
  const result = formatWorkflowLinkHtml({
    workflowId: 'abc',
    url: 'https://example.com/w',
    title: '<script>alert(1)</script>',
  });
  assert.ok(!result.includes('<script>'));
  assert.ok(result.includes('&lt;script&gt;'));
});

test('formatWorkflowLinkTerminal shows a visible open URL', () => {
  const result = formatWorkflowLinkTerminal({
    workflowId: 'abc',
    url: 'https://n8n.example.com/workflow/abc',
    title: 'Test WF',
  });
  assert.ok(result.includes('Test WF'));
  assert.ok(result.includes('https://n8n.example.com/workflow/abc'));
});

test('formatWorkflowLinkTerminal shows target URL when Yagr auth bridge is used', () => {
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent('<html><body>hello</body></html>')}`;
  const result = formatWorkflowLinkTerminal({
    workflowId: 'abc',
    url: dataUrl,
    targetUrl: 'http://127.0.0.1:5678/workflow/abc',
    title: 'Test WF',
  });
  assert.match(result, /http:\/\/127\.0\.0\.1:\d+\/open\/n8n-workflow\/[0-9a-f]{16}/);
  assert.ok(!result.includes('data:text/html'));
});

test('enrichWorkflowEmbed preserves an already-resolved workflow target', () => {
  const result = enrichWorkflowEmbed({
    type: 'embed',
    toolName: 'presentWorkflowResult',
    kind: 'workflow',
    workflowId: 'abc',
    url: 'data:text/html,stub',
    targetUrl: 'https://example.com/workflow/abc',
    via: 'self-contained-auth',
  });
  assert.equal(result.url, 'data:text/html,stub');
  assert.equal(result.targetUrl, 'https://example.com/workflow/abc');
});

// ---------------------------------------------------------------------------
// Footer builders
// ---------------------------------------------------------------------------

test('buildWorkflowFooterHtml returns empty string for no embeds', () => {
  assert.equal(buildWorkflowFooterHtml([]), '');
});

test('buildWorkflowFooterPlain joins multiple embeds', () => {
  const result = buildWorkflowFooterPlain([
    { workflowId: 'a', url: 'https://a.com', title: 'WF A' },
    { workflowId: 'b', url: 'https://b.com', title: 'WF B' },
  ]);
  assert.match(result, /WF A/);
  assert.match(result, /WF B/);
});

test('buildWorkflowFooterTerminal joins multiple embeds', () => {
  const result = buildWorkflowFooterTerminal([
    { workflowId: 'a', url: 'https://a.com', title: 'WF A' },
    { workflowId: 'b', url: 'https://b.com' },
  ]);
  assert.match(result, /WF A/);
  assert.match(result, /Workflow b/);
});

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

test('escapeHtml escapes ampersand, angle brackets', () => {
  assert.equal(escapeHtml('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
});

// ---------------------------------------------------------------------------
// markdownToTelegramHtml
// ---------------------------------------------------------------------------

test('markdownToTelegramHtml converts headers to bold', () => {
  const result = markdownToTelegramHtml('## Hello World');
  assert.match(result, /<b>Hello World<\/b>/);
});

test('markdownToTelegramHtml converts bold text', () => {
  const result = markdownToTelegramHtml('This is **bold** text');
  assert.match(result, /<b>bold<\/b>/);
});

test('markdownToTelegramHtml converts italic text', () => {
  const result = markdownToTelegramHtml('This is *italic* text');
  assert.match(result, /<i>italic<\/i>/);
});

test('markdownToTelegramHtml converts inline code', () => {
  const result = markdownToTelegramHtml('Use `npm install` to install');
  assert.match(result, /<code>npm install<\/code>/);
});

test('markdownToTelegramHtml converts fenced code blocks', () => {
  const md = '```\nconsole.log("hello");\n```';
  const result = markdownToTelegramHtml(md);
  assert.match(result, /<pre>console\.log\("hello"\);<\/pre>/);
});

test('markdownToTelegramHtml converts links', () => {
  const result = markdownToTelegramHtml('See [docs](https://example.com)');
  assert.match(result, /<a href="https:\/\/example\.com">docs<\/a>/);
});

test('markdownToTelegramHtml converts list items to bullets', () => {
  const result = markdownToTelegramHtml('- item one\n- item two');
  assert.match(result, /• item one/);
  assert.match(result, /• item two/);
});

test('markdownToTelegramHtml escapes HTML entities in plain text', () => {
  const result = markdownToTelegramHtml('a < b & c > d');
  assert.match(result, /a &lt; b &amp; c &gt; d/);
});

test('markdownToTelegramHtml handles unclosed code block gracefully', () => {
  const md = '```\nsome code\nmore code';
  const result = markdownToTelegramHtml(md);
  assert.match(result, /<pre>some code\nmore code<\/pre>/);
});

test('markdownToTelegramHtml preserves plain text without markdown', () => {
  const result = markdownToTelegramHtml('Just a plain sentence.');
  assert.equal(result, 'Just a plain sentence.');
});

test('markdownToTelegramHtml handles mixed content', () => {
  const md = [
    '# Title',
    '',
    'Some **bold** and *italic* text.',
    '',
    '- First item',
    '- Second item',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    'See [link](https://example.com).',
  ].join('\n');

  const result = markdownToTelegramHtml(md);
  assert.match(result, /<b>Title<\/b>/);
  assert.match(result, /<b>bold<\/b>/);
  assert.match(result, /<i>italic<\/i>/);
  assert.match(result, /• First item/);
  assert.match(result, /<pre>const x = 1;<\/pre>/);
  assert.match(result, /<a href="https:\/\/example\.com">link<\/a>/);
});
