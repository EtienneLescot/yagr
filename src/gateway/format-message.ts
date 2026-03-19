/**
 * Shared message formatting utilities for TUI and Telegram gateways.
 * Single source of truth for workflow-link rendering and markdown-to-surface conversion.
 */

import type { YagrToolEvent } from '../types.js';

// ---------------------------------------------------------------------------
// Workflow embed extraction (from tool events)
// ---------------------------------------------------------------------------

export interface WorkflowEmbed {
  workflowId: string;
  url: string;
  title?: string;
}

export function extractWorkflowEmbed(event: YagrToolEvent): WorkflowEmbed | undefined {
  if (event.type === 'embed' && event.kind === 'workflow') {
    return { workflowId: event.workflowId, url: event.url, title: event.title };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Workflow link formatting — one per surface
// ---------------------------------------------------------------------------

export function formatWorkflowLinkPlain(embed: WorkflowEmbed): string {
  const label = embed.title ?? `Workflow ${embed.workflowId}`;
  return `🔗 ${label}\n   ${embed.url}`;
}

export function formatWorkflowLinkHtml(embed: WorkflowEmbed): string {
  const label = escapeHtml(embed.title ?? `Workflow ${embed.workflowId}`);
  return `🔗 <b>${label}</b>\n${embed.url}`;
}

export function formatWorkflowLinkTerminal(embed: WorkflowEmbed): string {
  const label = embed.title ?? `Workflow ${embed.workflowId}`;
  return `🔗 \x1b]8;;${embed.url}\x07${label}\x1b]8;;\x07`;
}

// ---------------------------------------------------------------------------
// Workflow footer builder (appended to response messages)
// ---------------------------------------------------------------------------

export function buildWorkflowFooterPlain(embeds: WorkflowEmbed[]): string {
  if (embeds.length === 0) return '';
  return embeds.map(formatWorkflowLinkPlain).join('\n');
}

export function buildWorkflowFooterHtml(embeds: WorkflowEmbed[]): string {
  if (embeds.length === 0) return '';
  return embeds.map(formatWorkflowLinkHtml).join('\n');
}

export function buildWorkflowFooterTerminal(embeds: WorkflowEmbed[]): string {
  if (embeds.length === 0) return '';
  return embeds.map(formatWorkflowLinkTerminal).join('\n');
}

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Markdown → Telegram HTML conversion
// ---------------------------------------------------------------------------

/**
 * Convert LLM-produced markdown to Telegram-compatible HTML.
 * Handles: fenced code blocks, inline code, bold, italic, links, headers, lists.
 * Falls back to HTML-escaped plain text on any error.
 */
export function markdownToTelegramHtml(markdown: string): string {
  try {
    return convertMarkdownToHtml(markdown);
  } catch {
    return escapeHtml(markdown);
  }
}

function convertMarkdownToHtml(md: string): string {
  const lines = md.split('\n');
  const output: string[] = [];
  let inCode = false;
  const codeBuf: string[] = [];

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        output.push(`<pre>${escapeHtml(codeBuf.join('\n'))}</pre>`);
        codeBuf.length = 0;
      }
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    output.push(convertMarkdownLine(line));
  }

  if (codeBuf.length > 0) {
    output.push(`<pre>${escapeHtml(codeBuf.join('\n'))}</pre>`);
  }

  return output.join('\n');
}

function convertMarkdownLine(line: string): string {
  const trimmed = line.trimStart();

  const headerMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
  if (headerMatch) {
    return `\n<b>${convertInline(headerMatch[1])}</b>`;
  }

  if (/^[-*]\s/.test(trimmed)) {
    return `• ${convertInline(trimmed.replace(/^[-*]\s+/, ''))}`;
  }

  return convertInline(line);
}

/**
 * Character-level inline conversion.
 * Extracts code spans, links, bold, italic one token at a time so that
 * HTML entities inside code / URLs are never double-escaped.
 */
function convertInline(text: string): string {
  let result = '';
  let i = 0;

  while (i < text.length) {
    // Inline code
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        result += `<code>${escapeHtml(text.slice(i + 1, end))}</code>`;
        i = end + 1;
        continue;
      }
    }

    // Link: [text](url)
    if (text[i] === '[') {
      const closeBracket = text.indexOf(']', i + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const linkText = text.slice(i + 1, closeBracket);
          const url = text.slice(closeBracket + 2, closeParen);
          result += `<a href="${escapeHtml(url)}">${escapeHtml(linkText)}</a>`;
          i = closeParen + 1;
          continue;
        }
      }
    }

    // Bold: **text**
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        result += `<b>${escapeHtml(text.slice(i + 2, end))}</b>`;
        i = end + 2;
        continue;
      }
    }

    // Italic: *text* (single asterisk, not followed by another)
    if (text[i] === '*' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1);
      if (end !== -1 && text[end + 1] !== '*') {
        result += `<i>${escapeHtml(text.slice(i + 1, end))}</i>`;
        i = end + 1;
        continue;
      }
    }

    // Regular character — escape HTML
    const ch = text[i];
    if (ch === '&') result += '&amp;';
    else if (ch === '<') result += '&lt;';
    else if (ch === '>') result += '&gt;';
    else result += ch;
    i++;
  }

  return result;
}
