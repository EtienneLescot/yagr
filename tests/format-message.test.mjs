import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildWorkflowFooterHtml,
  buildWorkflowFooterPlain,
  buildWorkflowFooterTerminal,
  escapeHtml,
  extractWorkflowEmbed,
  formatWorkflowLinkHtml,
  formatWorkflowLinkPlain,
  formatTerminalLink,
  formatWorkflowLinkTerminal,
  markdownToTelegramHtml,
  resolveTerminalWorkflowOpenUrl,
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

test('buildWorkflowFooterHtml can resolve tokenized hosted bridge links', () => {
  const previousHome = process.env.YAGR_HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-footer-html-'));
  process.env.YAGR_HOME = tempHome;
  try {
    const result = buildWorkflowFooterHtml([
      {
        workflowId: 'abc',
        url: 'data:text/html;charset=utf-8,%3Chtml%3Ebridge%3C%2Fhtml%3E',
        title: 'Test WF',
      },
    ], {
      openBaseUrl: 'http://127.0.0.1:3789',
    });
    assert.match(result, /<a href="http:\/\/127\.0\.0\.1:3789\/open\/n8n-workflow\/[0-9a-f]{16}">Test WF<\/a>/);
    assert.ok(!result.includes('data:text/html'));
  } finally {
    if (previousHome === undefined) {
      delete process.env.YAGR_HOME;
    } else {
      process.env.YAGR_HOME = previousHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('workflow open links prefer the public bridge tunnel when active', () => {
  const previousHome = process.env.YAGR_HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-open-bridge-'));
  process.env.YAGR_HOME = tempHome;

  try {
    const proxyRuntimeDir = path.join(tempHome, 'proxy-runtime');
    fs.mkdirSync(proxyRuntimeDir, { recursive: true });
    fs.writeFileSync(path.join(proxyRuntimeDir, 'n8n-auth-tunnel.json'), JSON.stringify({
      pid: process.pid,
      publicUrl: 'https://workflow-open.example.trycloudflare.com',
      targetUrl: 'http://127.0.0.1:3791',
      startedAt: new Date().toISOString(),
    }, null, 2));

    const dataUrl = 'data:text/html;charset=utf-8,%3Chtml%3Ebridge%3C%2Fhtml%3E';
    const terminalUrl = resolveTerminalWorkflowOpenUrl({
      workflowId: 'abc',
      url: dataUrl,
      title: 'Test WF',
    });
    assert.match(terminalUrl, /^https:\/\/workflow-open\.example\.trycloudflare\.com\/open\/n8n-workflow\/[0-9a-f]{16}$/);

    const html = buildWorkflowFooterHtml([
      {
        workflowId: 'abc',
        url: dataUrl,
        title: 'Test WF',
      },
    ], {
      openBaseUrl: 'http://127.0.0.1:3789',
    });
    assert.match(html, /https:\/\/workflow-open\.example\.trycloudflare\.com\/open\/n8n-workflow\/[0-9a-f]{16}/);
    assert.ok(!html.includes('127.0.0.1:3789/open/n8n-workflow/'));
  } finally {
    if (previousHome === undefined) {
      delete process.env.YAGR_HOME;
    } else {
      process.env.YAGR_HOME = previousHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
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

test('formatTerminalLink produces an OSC 8 alias link', () => {
  const result = formatTerminalLink('click here', 'https://example.com/workflow/abc');
  assert.ok(result.includes('\x1b]8;;https://example.com/workflow/abc\x07'));
  assert.ok(result.includes('click here'));
  assert.ok(result.includes('\x1b]8;;\x07'));
});

test('formatWorkflowLinkTerminal renders an alias label', () => {
  const previousHome = process.env.YAGR_HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-terminal-alias-'));
  process.env.YAGR_HOME = tempHome;
  try {
    const result = formatWorkflowLinkTerminal({
      workflowId: 'abc',
      url: 'https://n8n.example.com/workflow/abc',
      title: 'Test WF',
    });
    assert.ok(result.includes('Test WF'));
    assert.ok(result.includes('\x1b]8;;http://127.0.0.1:'));
  } finally {
    if (previousHome === undefined) {
      delete process.env.YAGR_HOME;
    } else {
      process.env.YAGR_HOME = previousHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('formatWorkflowLinkTerminal always aliases the embed url through the local bridge', () => {
  const previousHome = process.env.YAGR_HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-terminal-bridge-'));
  process.env.YAGR_HOME = tempHome;
  try {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent('<html><body>hello</body></html>')}`;
    const result = formatWorkflowLinkTerminal({
      workflowId: 'abc',
      url: dataUrl,
      targetUrl: 'http://127.0.0.1:5678/workflow/abc',
      title: 'Test WF',
    });
    assert.match(result, /\x1b]8;;http:\/\/127\.0\.0\.1:\d+\/open\/n8n-workflow\/[0-9a-f]{16}\x07/);
    assert.ok(!result.includes('data:text/html'));
  } finally {
    if (previousHome === undefined) {
      delete process.env.YAGR_HOME;
    } else {
      process.env.YAGR_HOME = previousHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
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
