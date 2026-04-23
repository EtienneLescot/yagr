/**
 * Shared message formatting utilities for TUI and Telegram gateways.
 * Single source of truth for workflow banner rendering and markdown-to-surface conversion.
 */
import type { YagrToolEvent } from '../types.js';
export interface WorkflowEmbed {
    workflowId: string;
    url: string;
    targetUrl?: string;
    title?: string;
    diagram?: string;
    executionResult?: {
        status: 'success' | 'error' | 'waiting';
        executionId?: string;
        summary?: string;
        data?: string;
    };
}
export declare function workflowEmbedKey(embed: WorkflowEmbed): string;
export declare function extractWorkflowEmbed(event: YagrToolEvent): WorkflowEmbed | undefined;
export declare function formatWorkflowLinkPlain(embed: WorkflowEmbed): string;
export declare function formatWorkflowLinkHtml(embed: WorkflowEmbed, openUrl?: string): string;
export declare function formatTerminalLink(label: string, url: string): string;
export declare function formatWorkflowLinkTerminal(embed: WorkflowEmbed): string;
export declare function buildWorkflowBannerPlain(embeds: WorkflowEmbed[]): string;
export declare function buildWorkflowBannerHtml(embeds: WorkflowEmbed[]): string;
export declare function buildWorkflowBannerTerminal(embeds: WorkflowEmbed[]): string;
export declare const buildWorkflowFooterPlain: typeof buildWorkflowBannerPlain;
export declare const buildWorkflowFooterHtml: typeof buildWorkflowBannerHtml;
export declare const buildWorkflowFooterTerminal: typeof buildWorkflowBannerTerminal;
export declare function escapeHtml(text: string): string;
export declare function resolveTerminalWorkflowOpenUrl(embed: WorkflowEmbed): string;
/**
 * Convert LLM-produced markdown to Telegram-compatible HTML.
 * Handles: fenced code blocks, inline code, bold, italic, links, headers, lists.
 * Falls back to HTML-escaped plain text on any error.
 */
export declare function markdownToTelegramHtml(markdown: string): string;
//# sourceMappingURL=format-message.d.ts.map