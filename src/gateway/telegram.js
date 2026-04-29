import { randomBytes } from 'node:crypto';
import qrcode from 'qrcode-terminal';
import { Telegraf } from 'telegraf';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { getYagrDeepAgentSessionsDir, getYagrMemoriesDir } from '../config/yagr-home.js';
import { YagrSetupApplicationService } from '../setup/application-services.js';
import { createYagrDeepAgent } from '../agent-factory.js';
import { createRunAccumulator, processStreamEvent } from './langgraph-events.js';
import { SessionService, deriveSessionTitle } from '@yagr/session-service';
import { SlashCommandService } from '@yagr/conversation-service';
import { markdownToTelegramHtml, escapeHtml, } from './format-message.js';
const TELEGRAM_MESSAGE_LIMIT = 4096;
function formatTelegramProgressHtml(update) {
    const title = escapeHtml(update.title);
    const detail = update.detail ? escapeHtml(update.detail) : '';
    return detail ? `<b>${title}</b>\n${detail}` : `<b>${title}</b>`;
}
export function createOnboardingToken() {
    return randomBytes(18).toString('base64url');
}
export function buildTelegramDeepLink(botUsername, onboardingToken) {
    return `https://t.me/${botUsername}?start=${onboardingToken}`;
}
export function upsertLinkedChat(chats, nextChat) {
    const chatId = String(nextChat.chatId);
    const existing = chats.find((entry) => String(entry.chatId) === chatId);
    if (!existing) {
        return [...chats, { ...nextChat, chatId }];
    }
    return chats.map((entry) => (String(entry.chatId) === chatId
        ? { ...entry, ...nextChat, chatId }
        : entry));
}
export function removeLinkedChat(chats, chatId) {
    return chats.filter((entry) => String(entry.chatId) !== String(chatId));
}
export function splitTelegramMessage(text, limit = TELEGRAM_MESSAGE_LIMIT) {
    const normalized = text.trim();
    if (!normalized) {
        return [];
    }
    const chunks = [];
    let remaining = normalized;
    while (remaining.length > limit) {
        const candidate = remaining.slice(0, limit);
        const splitAt = Math.max(candidate.lastIndexOf('\n\n'), candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
        const cut = splitAt > Math.floor(limit * 0.6) ? splitAt : limit;
        chunks.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
    }
    if (remaining) {
        chunks.push(remaining);
    }
    return chunks;
}
function buildTelegramTokenInstructions() {
    return [
        '1) Open Telegram and chat with @BotFather',
        '2) Run /newbot (or /mybots)',
        '3) Copy the token (looks like 123456:ABC...)',
        'Yagr stores this token during setup.',
        'Docs: https://core.telegram.org/bots#how-do-i-create-a-bot',
    ].join('\n');
}
function formatLinkedChatCount(count) {
    return count === 1 ? '1 linked chat' : `${count} linked chats`;
}
function formatRequiredActions(actions) {
    if (actions.length === 0) {
        return '';
    }
    const blocking = actions.filter((action) => action.blocking !== false);
    const followUp = actions.filter((action) => action.blocking === false);
    const lines = [];
    if (blocking.length > 0) {
        lines.push('Required actions:');
        lines.push(...blocking.map((action) => `- ${action.title}: ${action.message}`));
        lines.push('Use /approve to resume if the request can be approved.');
    }
    if (followUp.length > 0) {
        if (lines.length > 0) {
            lines.push('');
        }
        lines.push('Next steps:');
        lines.push(...followUp.map((action) => `- ${action.title}: ${action.message}`));
    }
    return lines.join('\n');
}
export async function resolveTelegramBotIdentity(botToken) {
    const bot = new Telegraf(botToken);
    const me = await bot.telegram.getMe();
    if (!me.username) {
        throw new Error('Telegram bot username is missing. Configure the bot with BotFather first.');
    }
    return {
        username: me.username,
        firstName: me.first_name,
    };
}
export async function setupTelegramGateway(configService = new YagrConfigService()) {
    const currentToken = configService.getTelegramBotToken() ?? '';
    const setupService = new YagrSetupApplicationService(configService, {
        resolveTelegramIdentity: resolveTelegramBotIdentity,
        createOnboardingToken,
    });
    if (!currentToken) {
        process.stdout.write(`\nTo create a Telegram bot token:\n${buildTelegramTokenInstructions()}\n`);
    }
    const readline = await import('node:readline/promises');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let botToken;
    try {
        if (currentToken) {
            const answer = await rl.question(`Reuse saved token? [Y/n] `);
            botToken = answer.trim().toLowerCase() === 'n' ? await rl.question('Telegram bot token: ') : currentToken;
        }
        else {
            botToken = await rl.question('Telegram bot token: ');
        }
    }
    finally {
        rl.close();
    }
    if (!botToken.includes(':'))
        throw new Error('Invalid Telegram bot token format.');
    process.stdout.write('Verifying token...\n');
    const identity = await setupService.configureTelegram(botToken);
    const nextConfig = configService.getLocalConfig();
    const deepLink = buildTelegramDeepLink(nextConfig.telegram?.botUsername ?? identity.username, nextConfig.telegram?.onboardingToken ?? createOnboardingToken());
    process.stdout.write(`\nTelegram bot ready: @${identity.username}\nOnboarding link: ${deepLink}\n`);
    qrcode.generate(deepLink, { small: true });
    process.stdout.write('Gateway saved. Start with `yagr gateway start`.\n');
}
export function showTelegramOnboarding(configService = new YagrConfigService()) {
    const status = new YagrSetupApplicationService(configService).getTelegramStatus();
    if (!status.configured || !status.botUsername || !status.deepLink) {
        throw new Error('Telegram is not configured. Run `yagr telegram setup` first.');
    }
    process.stdout.write([
        '',
        `Bot: @${status.botUsername}`,
        `Onboarding link: ${status.deepLink}`,
        `Linked chats: ${formatLinkedChatCount(status.linkedChats.length)}`,
        '',
        'Scan the QR or open the link, then press Start in Telegram.',
        '',
    ].join('\n'));
    qrcode.generate(status.deepLink, { small: true });
}
export function getTelegramGatewayStatus(configService = new YagrConfigService()) {
    return new YagrSetupApplicationService(configService).getTelegramStatus();
}
export function resetTelegramGateway(configService = new YagrConfigService()) {
    new YagrSetupApplicationService(configService).resetTelegram();
}
export function createTelegramGatewayRuntime(options = {}, configService = new YagrConfigService()) {
    const setupService = new YagrSetupApplicationService(configService);
    const { status, botToken, onboardingToken } = setupService.getTelegramRuntimeConfig(options.botToken);
    if (!botToken || !status.botUsername || !onboardingToken) {
        throw new Error('Telegram is not configured. Run `yagr telegram setup` first.');
    }
    const linkedCount = status.linkedChats.length;
    return {
        gateway: new TelegramGateway(options, configService, botToken, onboardingToken),
        startupMessages: [
            `Yagr Telegram gateway listening as @${status.botUsername}. ${formatLinkedChatCount(linkedCount)}.`,
            linkedCount === 0
                ? `No linked chats. Onboarding link: ${status.deepLink}`
                : 'Telegram transport is ready.',
        ],
        onboardingLink: status.deepLink && linkedCount === 0 ? status.deepLink : undefined,
    };
}
class TelegramGateway {
    options;
    configService;
    onboardingToken;
    bot;
    agentHandlePromise;
    sessions = new SessionService({
        sessionsDir: getYagrDeepAgentSessionsDir(),
        memoriesDir: getYagrMemoriesDir(),
    });
    runningChats = new Set();
    pendingApprovals = new Map();
    stopped = false;
    setupService;
    constructor(options, configService, botToken, onboardingToken) {
        this.options = options;
        this.configService = configService;
        this.onboardingToken = onboardingToken;
        this.bot = new Telegraf(botToken);
        this.setupService = new YagrSetupApplicationService(configService);
    }
    buildDeepLink() {
        const botUsername = this.setupService.getTelegramStatus().botUsername ?? '';
        return buildTelegramDeepLink(botUsername, this.onboardingToken);
    }
    async start() {
        this.bot.start(async (ctx) => {
            const payload = typeof ctx.payload === 'string' ? ctx.payload.trim() : '';
            const chatId = String(ctx.chat.id);
            if (payload !== this.onboardingToken) {
                const deepLink = this.buildDeepLink();
                await ctx.reply(`This link is invalid or expired. Click the link below to link this chat, then press Start:\n${deepLink}`);
                return;
            }
            this.linkChat({
                chatId,
                userId: String(ctx.from?.id ?? ''),
                username: ctx.from?.username,
                firstName: ctx.from?.first_name,
                linkedAt: new Date().toISOString(),
                lastSeenAt: new Date().toISOString(),
            });
            await ctx.reply('Yagr is now linked to this chat. You can talk to me directly here.');
        });
        this.bot.command('status', async (ctx) => {
            const chatId = String(ctx.chat.id);
            if (!this.isLinkedChat(chatId)) {
                const deepLink = this.buildDeepLink();
                await ctx.reply(`This chat is not linked. Click the link below, then press Start:\n${deepLink}`);
                return;
            }
            const linkedChats = this.setupService.getLinkedTelegramChats();
            await ctx.reply(`Telegram gateway is active. ${formatLinkedChatCount(linkedChats.length)}.`);
        });
        this.bot.command('pending', async (ctx) => {
            const chatId = String(ctx.chat.id);
            const actions = this.pendingApprovals.get(chatId) ?? [];
            if (actions.length === 0) {
                await ctx.reply('No actions pending.');
                return;
            }
            await ctx.reply(formatRequiredActions(actions));
        });
        this.bot.command('approve', async (ctx) => {
            const chatId = String(ctx.chat.id);
            if (!this.isLinkedChat(chatId)) {
                await ctx.reply('This chat is not linked.');
                return;
            }
            const actions = this.pendingApprovals.get(chatId) ?? [];
            if (actions.length === 0) {
                await ctx.reply('No approvable actions pending.');
                return;
            }
            await this.executeRun(chatId, 'Permission granted. Continue the current task and execute the previously blocked step now.', actions, ctx.reply.bind(ctx));
        });
        this.bot.command('link', async (ctx) => {
            if (this.isLinkedChat(String(ctx.chat.id))) {
                await ctx.reply('This chat is already linked to Yagr. You can talk to me directly.');
                return;
            }
            const deepLink = this.buildDeepLink();
            await ctx.reply(`To link this chat, click the link below, then press Start:\n${deepLink}`);
        });
        const clearSession = async (chatId, reply) => {
            await this.resetChatSession(chatId);
            await reply('Yagr conversation reset for this chat.');
        };
        this.bot.command('reset', async (ctx) => {
            await clearSession(String(ctx.chat.id), ctx.reply.bind(ctx));
        });
        this.bot.command('compact', async (ctx) => {
            await ctx.reply('Conversation compaction is handled automatically by Yagr.');
        });
        this.bot.command('unlink', async (ctx) => {
            const chatId = String(ctx.chat.id);
            if (!this.isLinkedChat(chatId)) {
                const deepLink = this.buildDeepLink();
                await ctx.reply(`This chat is not linked. Click the link below to link it:\n${deepLink}`);
                return;
            }
            this.unlinkChat(chatId);
            await this.resetChatSession(chatId);
            this.pendingApprovals.delete(chatId);
            await ctx.reply('Chat unlinked. Use the onboarding link or QR code again to reconnect.');
        });
        this.bot.command('checkpoints', async (ctx) => {
            const chatId = String(ctx.chat?.id);
            if (!this.isLinkedChat(chatId))
                return;
            const handle = await this.resolveAgentHandle();
            const threadId = await this.getOrCreateThreadId(chatId);
            const service = new SlashCommandService(this.sessions, handle.compactionService);
            const result = await service.execute({ command: 'checkpoints', args: [], raw: ctx.message?.text ?? '' }, { surface: 'telegram', sessionId: chatId, threadId }, this.createTelegramSlashHandler(chatId));
            await ctx.reply(result.message);
        });
        this.bot.command('checkpoint_save', async (ctx) => {
            const chatId = String(ctx.chat?.id);
            if (!this.isLinkedChat(chatId))
                return;
            const handle = await this.resolveAgentHandle();
            const threadId = await this.getOrCreateThreadId(chatId);
            const service = new SlashCommandService(this.sessions, handle.compactionService);
            const result = await service.execute({ command: 'save', args: [], raw: ctx.message?.text ?? '' }, { surface: 'telegram', sessionId: chatId, threadId }, this.createTelegramSlashHandler(chatId));
            await ctx.reply(result.message);
        });
        this.bot.command('checkpoint_restore', async (ctx) => {
            const chatId = String(ctx.chat?.id);
            if (!this.isLinkedChat(chatId))
                return;
            const handle = await this.resolveAgentHandle();
            const threadId = await this.getOrCreateThreadId(chatId);
            const args = (ctx.message?.text ?? '').split(' ').slice(1);
            const service = new SlashCommandService(this.sessions, handle.compactionService);
            const result = await service.execute({ command: 'restore', args, raw: ctx.message?.text ?? '' }, { surface: 'telegram', sessionId: chatId, threadId }, this.createTelegramSlashHandler(chatId));
            await ctx.reply(result.message);
        });
        this.bot.command('checkpoint_delete', async (ctx) => {
            const chatId = String(ctx.chat?.id);
            if (!this.isLinkedChat(chatId))
                return;
            const handle = await this.resolveAgentHandle();
            const threadId = await this.getOrCreateThreadId(chatId);
            const args = (ctx.message?.text ?? '').split(' ').slice(1);
            const service = new SlashCommandService(this.sessions, handle.compactionService);
            const result = await service.execute({ command: 'checkpoint_delete', args, raw: ctx.message?.text ?? '' }, { surface: 'telegram', sessionId: chatId, threadId }, this.createTelegramSlashHandler(chatId));
            await ctx.reply(result.message);
        });
        this.bot.command('help', async (ctx) => {
            const chatId = String(ctx.chat?.id);
            if (!this.isLinkedChat(chatId))
                return;
            const handle = await this.resolveAgentHandle();
            const threadId = await this.getOrCreateThreadId(chatId);
            const service = new SlashCommandService(this.sessions, handle.compactionService);
            const result = await service.execute({ command: 'help', args: [], raw: ctx.message?.text ?? '' }, { surface: 'telegram', sessionId: chatId, threadId }, this.createTelegramSlashHandler(chatId));
            await ctx.reply(result.message);
        });
        this.bot.command('sessions', async (ctx) => {
            const chatId = String(ctx.chat?.id);
            if (!this.isLinkedChat(chatId))
                return;
            const handle = await this.resolveAgentHandle();
            const threadId = await this.getOrCreateThreadId(chatId);
            const service = new SlashCommandService(this.sessions, handle.compactionService);
            const result = await service.execute({ command: 'sessions', args: [], raw: ctx.message?.text ?? '' }, { surface: 'telegram', sessionId: chatId, threadId }, this.createTelegramSlashHandler(chatId));
            await ctx.reply(result.message);
        });
        this.bot.command('resume', async (ctx) => {
            const chatId = String(ctx.chat?.id);
            if (!this.isLinkedChat(chatId))
                return;
            const handle = await this.resolveAgentHandle();
            const threadId = await this.getOrCreateThreadId(chatId);
            const args = (ctx.message?.text ?? '').split(' ').slice(1);
            const service = new SlashCommandService(this.sessions, handle.compactionService);
            const result = await service.execute({ command: 'resume', args, raw: ctx.message?.text ?? '' }, { surface: 'telegram', sessionId: chatId, threadId }, this.createTelegramSlashHandler(chatId));
            await ctx.reply(result.message);
        });
        this.bot.command('delete', async (ctx) => {
            const chatId = String(ctx.chat?.id);
            if (!this.isLinkedChat(chatId))
                return;
            const handle = await this.resolveAgentHandle();
            const threadId = await this.getOrCreateThreadId(chatId);
            const args = (ctx.message?.text ?? '').split(' ').slice(1);
            const service = new SlashCommandService(this.sessions, handle.compactionService);
            const result = await service.execute({ command: 'delete', args, raw: ctx.message?.text ?? '' }, { surface: 'telegram', sessionId: chatId, threadId }, this.createTelegramSlashHandler(chatId));
            await ctx.reply(result.message);
        });
        this.bot.command('new', async (ctx) => {
            const chatId = String(ctx.chat?.id);
            if (!this.isLinkedChat(chatId))
                return;
            const handle = await this.resolveAgentHandle();
            const threadId = await this.getOrCreateThreadId(chatId);
            const service = new SlashCommandService(this.sessions, handle.compactionService);
            const result = await service.execute({ command: 'new', args: [], raw: ctx.message?.text ?? '' }, { surface: 'telegram', sessionId: chatId, threadId }, this.createTelegramSlashHandler(chatId));
            await ctx.reply(result.message);
        });
        this.bot.command('restore', async (ctx) => {
            const chatId = String(ctx.chat?.id);
            if (!this.isLinkedChat(chatId))
                return;
            const handle = await this.resolveAgentHandle();
            const threadId = await this.getOrCreateThreadId(chatId);
            const args = (ctx.message?.text ?? '').split(' ').slice(1);
            const service = new SlashCommandService(this.sessions, handle.compactionService);
            const result = await service.execute({ command: 'restore', args, raw: ctx.message?.text ?? '' }, { surface: 'telegram', sessionId: chatId, threadId }, this.createTelegramSlashHandler(chatId));
            await ctx.reply(result.message);
        });
        this.bot.on('text', async (ctx) => {
            const chatId = String(ctx.chat.id);
            const text = ctx.message.text.trim();
            if (!text || text.startsWith('/')) {
                return;
            }
            if (ctx.chat.type !== 'private') {
                await ctx.reply('Telegram currently supports private chats only.');
                return;
            }
            if (!this.isLinkedChat(chatId)) {
                const deepLink = this.buildDeepLink();
                await ctx.reply(`This chat is not linked yet. Click the link below, then press Start:\n${deepLink}`);
                return;
            }
            this.touchChat(chatId, ctx.from?.id, ctx.from?.username, ctx.from?.first_name);
            await this.executeRun(chatId, text, [], ctx.reply.bind(ctx));
        });
        // bot.launch() never resolves while running — start it without awaiting
        // so the caller can proceed (print banner, wait for SIGINT, etc.)
        this.bot.launch({ dropPendingUpdates: true }).catch((err) => {
            if (!this.stopped) {
                process.stderr.write(`Telegram gateway error: ${err instanceof Error ? err.message : String(err)}\n`);
            }
        });
        // Give Telegraf a moment to connect and throw early if the token is invalid
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, 1500);
            this.bot.telegram.getMe().then(() => {
                clearTimeout(timeout);
                resolve();
            }).catch((err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }
    async stop() {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        this.bot.stop('Yagr Telegram gateway stopping');
    }
    async reply(chatId, message) {
        const parts = splitTelegramMessage(message);
        for (const part of parts) {
            await this.bot.telegram.sendMessage(Number(chatId), part);
        }
    }
    async sendHtml(chatId, html) {
        const parts = splitTelegramMessage(html);
        for (const part of parts) {
            try {
                await this.bot.telegram.sendMessage(Number(chatId), part, { parse_mode: 'HTML' });
            }
            catch {
                // Fallback to plain text if HTML parsing fails
                await this.bot.telegram.sendMessage(Number(chatId), part);
            }
        }
    }
    linkChat(chat) {
        this.setupService.linkTelegramChat(chat);
    }
    unlinkChat(chatId) {
        this.setupService.unlinkTelegramChat(chatId);
    }
    touchChat(chatId, userId, username, firstName) {
        this.setupService.touchTelegramChat(chatId, userId, username, firstName);
    }
    isLinkedChat(chatId) {
        return this.setupService.isTelegramChatLinked(chatId);
    }
    async resolveAgentHandle() {
        if (!this.agentHandlePromise) {
            this.agentHandlePromise = createYagrDeepAgent(this.configService, undefined, undefined, this.options);
            const handle = await this.agentHandlePromise;
            this.sessions.setCheckpointer(handle.checkpointer);
        }
        return this.agentHandlePromise;
    }
    getTelegramScope(chatId) {
        return { kind: 'telegram', key: chatId };
    }
    createTelegramSlashHandler(chatId) {
        const scope = this.getTelegramScope(chatId);
        return {
            getActiveSessionId: () => this.sessions.getActiveForScope(scope)?.id,
            resumeSession: (_scope, sessionId) => {
                this.sessions.ensure(sessionId, { scope });
            },
            resetLocalState: () => {
                this.pendingApprovals.delete(chatId);
            },
        };
    }
    async getOrCreateThreadId(chatId) {
        const session = this.sessions.getOrCreateForScope(this.getTelegramScope(chatId), { title: `Telegram chat ${chatId}` });
        return session.id;
    }
    async resetChatSession(chatId) {
        const scope = this.getTelegramScope(chatId);
        const oldSession = this.sessions.getOrCreateForScope(scope, { title: `Telegram chat ${chatId}` });
        const oldSessionId = oldSession.id;
        this.sessions.rotateForScope(scope, { title: `Telegram chat ${chatId}` });
        if (this.agentHandlePromise) {
            const { compactionService } = await this.resolveAgentHandle();
            compactionService.reset(oldSessionId);
        }
        // Delete old thread from checkpointer (avoid re-deleting the record since rotateForScope already closed it)
        try {
            await this.sessions.delete(oldSessionId);
        }
        catch {
            // Ignore if checkpointer not set yet
        }
        this.pendingApprovals.delete(chatId);
    }
    async executeRun(chatId, prompt, _satisfiedRequiredActions, reply) {
        if (this.runningChats.has(chatId)) {
            await reply('A run is already in progress for this chat. Wait for it to finish before sending another request.');
            return;
        }
        this.runningChats.add(chatId);
        try {
            await reply('Yagr is working...');
            const { agent } = await this.resolveAgentHandle();
            const threadId = await this.getOrCreateThreadId(chatId);
            this.sessions.touch(threadId, { title: deriveSessionTitle(prompt, `Telegram chat ${chatId}`) });
            const accumulator = createRunAccumulator();
            let lastProgressKey = '';
            const sendProgressUpdate = async (update) => {
                if (update.dedupeKey === lastProgressKey) {
                    return;
                }
                lastProgressKey = update.dedupeKey;
                await this.sendHtml(chatId, formatTelegramProgressHtml(update));
            };
            const stream = agent.streamEvents({ messages: [{ role: 'user', content: prompt }] }, this.sessions.buildSessionConfig(threadId));
            for await (const event of stream) {
                await processStreamEvent(event, accumulator, {
                    onUserVisibleUpdate: sendProgressUpdate,
                    onCompaction: async (compaction) => {
                        const { compactionService } = await this.resolveAgentHandle();
                        await compactionService.notifyCompaction(threadId, compaction);
                        const msg = `🗜️ <b>Context compacted</b>\n${compaction.summary}\n(${compaction.messagesCompacted} msgs → ${compaction.preservedRecentMessages} preserved)`;
                        await this.sendHtml(chatId, msg);
                    },
                });
            }
            if (accumulator.requiredActions.length > 0) {
                this.pendingApprovals.set(chatId, accumulator.requiredActions);
            }
            else {
                this.pendingApprovals.delete(chatId);
            }
            const htmlSections = [];
            if (accumulator.responseText.trim()) {
                htmlSections.push(markdownToTelegramHtml(accumulator.responseText.trim()));
            }
            const requiredActionsText = formatRequiredActions(accumulator.requiredActions);
            if (requiredActionsText) {
                htmlSections.push(escapeHtml(requiredActionsText));
            }
            const htmlMessage = htmlSections.filter(Boolean).join('\n\n');
            if (!htmlMessage) {
                await reply('Run finished, but no text response was produced.');
                return;
            }
            await this.sendHtml(chatId, htmlMessage);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await reply(`Run failed: ${message}`);
        }
        finally {
            this.runningChats.delete(chatId);
        }
    }
}
export async function runTelegramGateway(options = {}, configService = new YagrConfigService()) {
    const runtime = createTelegramGatewayRuntime(options, configService);
    for (const line of runtime.startupMessages) {
        process.stdout.write(`${line}\n`);
    }
    if (runtime.onboardingLink) {
        process.stdout.write(`Onboarding link: ${runtime.onboardingLink}\n`);
        qrcode.generate(runtime.onboardingLink, { small: true });
    }
    await runtime.gateway.start();
    await new Promise((resolve) => {
        const stop = async () => {
            await runtime.gateway.stop();
            resolve();
        };
        process.once('SIGINT', () => {
            void stop();
        });
        process.once('SIGTERM', () => {
            void stop();
        });
    });
}
//# sourceMappingURL=telegram.js.map