/**
 * Shared message formatting utilities for TUI and Telegram gateways.
 * Single source of truth for workflow banner rendering and markdown-to-surface conversion.
 */
export function workflowEmbedKey(embed) {
    return `${embed.workflowId}::${embed.targetUrl ?? embed.url}`;
}
export function extractWorkflowEmbed(event) {
    if (event.type === 'embed' && event.kind === 'workflow') {
        return {
            workflowId: event.workflowId,
            url: event.url,
            targetUrl: event.targetUrl,
            title: event.title,
            diagram: event.diagram,
            executionResult: event.executionResult,
        };
    }
    return undefined;
}
// ---------------------------------------------------------------------------
// Workflow banner rendering — one per surface
// ---------------------------------------------------------------------------
export function formatWorkflowLinkPlain(embed) {
    const label = embed.title ?? `Workflow ${embed.workflowId}`;
    return `🔗 ${label}`;
}
export function formatWorkflowLinkHtml(embed, openUrl = embed.url) {
    const label = escapeHtml(embed.title ?? `Workflow ${embed.workflowId}`);
    return `🔗 <a href="${escapeHtml(openUrl)}">${label}</a>`;
}
export function formatTerminalLink(label, url) {
    return `\x1b]8;;${url}\x07${label}\x1b]8;;\x07`;
}
export function formatWorkflowLinkTerminal(embed) {
    const label = embed.title ?? `Workflow ${embed.workflowId}`;
    return `🔗 ${formatTerminalLink(label, resolveTerminalWorkflowOpenUrl(embed))}`;
}
// ---------------------------------------------------------------------------
// Workflow footer builder (appended to response messages)
// ---------------------------------------------------------------------------
export function buildWorkflowBannerPlain(embeds) {
    const uniqueEmbeds = dedupeWorkflowEmbeds(embeds);
    if (uniqueEmbeds.length === 0)
        return '';
    return uniqueEmbeds.map(formatWorkflowLinkPlain).join('\n');
}
export function buildWorkflowBannerHtml(embeds) {
    const uniqueEmbeds = dedupeWorkflowEmbeds(embeds);
    if (uniqueEmbeds.length === 0)
        return '';
    return uniqueEmbeds.map((embed) => formatWorkflowLinkHtml(embed, embed.url)).join('\n');
}
export function buildWorkflowBannerTerminal(embeds) {
    const uniqueEmbeds = dedupeWorkflowEmbeds(embeds);
    if (uniqueEmbeds.length === 0)
        return '';
    return uniqueEmbeds.map(formatWorkflowLinkTerminal).join('\n');
}
// Backward-compatible aliases while the repo converges on the "banner" wording.
export const buildWorkflowFooterPlain = buildWorkflowBannerPlain;
export const buildWorkflowFooterHtml = buildWorkflowBannerHtml;
export const buildWorkflowFooterTerminal = buildWorkflowBannerTerminal;
// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------
export function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function resolveTerminalWorkflowOpenUrl(embed) {
    return embed.url;
}
function dedupeWorkflowEmbeds(embeds) {
    const seen = new Set();
    const unique = [];
    for (const embed of embeds) {
        const key = workflowEmbedKey(embed);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        unique.push(embed);
    }
    return unique;
}
// ---------------------------------------------------------------------------
// Markdown → Telegram HTML conversion
// ---------------------------------------------------------------------------
/**
 * Convert LLM-produced markdown to Telegram-compatible HTML.
 * Handles: fenced code blocks, inline code, bold, italic, links, headers, lists.
 * Falls back to HTML-escaped plain text on any error.
 */
export function markdownToTelegramHtml(markdown) {
    try {
        return convertMarkdownToHtml(markdown);
    }
    catch {
        return escapeHtml(markdown);
    }
}
function convertMarkdownToHtml(md) {
    const lines = md.split('\n');
    const output = [];
    let inCode = false;
    const codeBuf = [];
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
function convertMarkdownLine(line) {
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
function convertInline(text) {
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
        if (ch === '&')
            result += '&amp;';
        else if (ch === '<')
            result += '&lt;';
        else if (ch === '>')
            result += '&gt;';
        else
            result += ch;
        i++;
    }
    return result;
}
//# sourceMappingURL=format-message.js.map