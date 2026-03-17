import * as p from '@clack/prompts';
import { randomBytes } from 'node:crypto';
import qrcode from 'qrcode-terminal';
import { Telegraf } from 'telegraf';
import { YagrAgent } from '../agent.js';
import { YagrConfigService, type YagrTelegramLinkedChat } from '../config/yagr-config-service.js';
import type { Engine } from '../engine/engine.js';
import type { YagrRequiredAction, YagrRunOptions } from '../types.js';
import type { Gateway, GatewayRuntimeHandle } from './types.js';

const TELEGRAM_MESSAGE_LIMIT = 4096;

export function createOnboardingToken(): string {
  return randomBytes(18).toString('base64url');
}

export function buildTelegramDeepLink(botUsername: string, onboardingToken: string): string {
  return `https://t.me/${botUsername}?start=${onboardingToken}`;
}

export function upsertLinkedChat(
  chats: YagrTelegramLinkedChat[],
  nextChat: YagrTelegramLinkedChat,
): YagrTelegramLinkedChat[] {
  const chatId = String(nextChat.chatId);
  const existing = chats.find((entry) => String(entry.chatId) === chatId);

  if (!existing) {
    return [...chats, { ...nextChat, chatId }];
  }

  return chats.map((entry) => (
    String(entry.chatId) === chatId
      ? { ...entry, ...nextChat, chatId }
      : entry
  ));
}

export function removeLinkedChat(chats: YagrTelegramLinkedChat[], chatId: string): YagrTelegramLinkedChat[] {
  return chats.filter((entry) => String(entry.chatId) !== String(chatId));
}

export function splitTelegramMessage(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
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

interface TelegramGatewayRuntimeOptions extends YagrRunOptions {
  botToken?: string;
}

export interface TelegramGatewayStatus {
  configured: boolean;
  botUsername?: string;
  linkedChats: YagrTelegramLinkedChat[];
  deepLink?: string;
}

function buildTelegramTokenInstructions(): string {
  return [
    '1) Open Telegram and chat with @BotFather',
    '2) Run /newbot (or /mybots)',
    '3) Copy the token (looks like 123456:ABC...)',
    'Yagr stores this token during setup.',
    'Docs: https://core.telegram.org/bots#how-do-i-create-a-bot',
  ].join('\n');
}

function formatLinkedChatCount(count: number): string {
  return count === 1 ? '1 chat lie' : `${count} chats lies`;
}

function formatRequiredActions(actions: YagrRequiredAction[]): string {
  if (actions.length === 0) {
    return '';
  }

  return [
    'Actions requises :',
    ...actions.map((action) => `- ${action.title}: ${action.message}`),
    'Utilise /approve pour reprendre si la demande est approuvable.',
  ].join('\n');
}

async function resolveTelegramBotIdentity(botToken: string): Promise<{ username: string; firstName: string }> {
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

export async function setupTelegramGateway(configService = new YagrConfigService()): Promise<void> {
  const current = configService.getLocalConfig();
  const currentToken = configService.getTelegramBotToken() ?? '';

  if (!currentToken) {
    p.note(buildTelegramTokenInstructions(), 'Telegram bot token');
  }

  const tokenAnswer = currentToken || await p.password({
    message: 'Telegram bot token',
    validate: (value) => value && value.includes(':') ? undefined : 'Enter a valid BotFather token.',
  });

  if (p.isCancel(tokenAnswer)) {
    p.cancel('Telegram setup cancelled.');
    return;
  }

  const botToken = String(tokenAnswer);
  const spinner = p.spinner();
  spinner.start('Checking Telegram bot token...');

  let identity: { username: string; firstName: string };
  try {
    identity = await resolveTelegramBotIdentity(botToken);
  } catch (error) {
    spinner.stop('Telegram setup failed.');
    throw error;
  }

  spinner.stop(`Telegram bot ready: @${identity.username}`);
  configService.saveTelegramBotToken(botToken);

  const nextConfig = configService.updateLocalConfig((localConfig) => ({
    ...localConfig,
    telegram: {
      ...localConfig.telegram,
      botUsername: identity.username,
      onboardingToken: localConfig.telegram?.onboardingToken ?? createOnboardingToken(),
      linkedChats: localConfig.telegram?.linkedChats ?? [],
    },
  }));
  configService.enableGatewaySurface('telegram');

  const deepLink = buildTelegramDeepLink(
    nextConfig.telegram?.botUsername ?? identity.username,
    nextConfig.telegram?.onboardingToken ?? createOnboardingToken(),
  );

  p.note(
    [
      `Bot: @${identity.username}`,
      `Lien d'onboarding: ${deepLink}`,
      `Chats deja lies: ${formatLinkedChatCount(nextConfig.telegram?.linkedChats?.length ?? 0)}`,
      '',
      'Scanne le QR ou ouvre le lien, puis appuie sur Start dans Telegram.',
    ].join('\n'),
    'Telegram setup',
  );
  qrcode.generate(deepLink, { small: true });
  p.outro('Telegram setup saved. Start the gateway with `yagr gateway start`.');
}

export function showTelegramOnboarding(configService = new YagrConfigService()): void {
  const status = getTelegramGatewayStatus(configService);

  if (!status.configured || !status.botUsername || !status.deepLink) {
    throw new Error('Telegram is not configured. Run `yagr telegram setup` first.');
  }

  p.note(
    [
      `Bot: @${status.botUsername}`,
      `Lien d'onboarding: ${status.deepLink}`,
      `Chats deja lies: ${formatLinkedChatCount(status.linkedChats.length)}`,
      '',
      'Scanne le QR ou ouvre le lien, puis appuie sur Start dans Telegram.',
    ].join('\n'),
    'Telegram onboarding',
  );
  qrcode.generate(status.deepLink, { small: true });
}

export function getTelegramGatewayStatus(configService = new YagrConfigService()): TelegramGatewayStatus {
  const localConfig = configService.getLocalConfig();
  const telegram = localConfig.telegram;
  const botToken = configService.getTelegramBotToken();
  const linkedChats = telegram?.linkedChats ?? [];
  const deepLink = telegram?.botUsername && telegram.onboardingToken
    ? buildTelegramDeepLink(telegram.botUsername, telegram.onboardingToken)
    : undefined;

  return {
    configured: Boolean(botToken && telegram?.botUsername && telegram?.onboardingToken),
    botUsername: telegram?.botUsername,
    linkedChats,
    deepLink,
  };
}

export function resetTelegramGateway(configService = new YagrConfigService()): void {
  configService.clearTelegramBotToken();
  configService.disableGatewaySurface('telegram');
  configService.updateLocalConfig((localConfig) => {
    const nextConfig = { ...localConfig };
    delete nextConfig.telegram;
    return nextConfig;
  });
}

export function createTelegramGatewayRuntime(
  engineResolver: () => Promise<Engine>,
  options: TelegramGatewayRuntimeOptions = {},
  configService = new YagrConfigService(),
): GatewayRuntimeHandle {
  const status = getTelegramGatewayStatus(configService);
  const botToken = options.botToken ?? configService.getTelegramBotToken();
  const onboardingToken = configService.getLocalConfig().telegram?.onboardingToken;

  if (!botToken || !status.botUsername || !onboardingToken) {
    throw new Error('Telegram is not configured. Run `yagr telegram setup` first.');
  }

  const linkedCount = status.linkedChats.length;

  return {
    gateway: new TelegramGateway(engineResolver, options, configService, botToken, onboardingToken),
    startupMessages: [
      `Yagr Telegram gateway listening as @${status.botUsername}. ${formatLinkedChatCount(linkedCount)}.`,
      'Telegram transport is ready. n8n backend will be resolved on first message.',
    ],
    onboardingLink: status.deepLink && linkedCount === 0 ? status.deepLink : undefined,
  };
}

class TelegramGateway implements Gateway {
  private readonly bot: Telegraf;
  private readonly agents = new Map<string, YagrAgent>();
  private readonly runningChats = new Set<string>();
  private readonly pendingApprovals = new Map<string, YagrRequiredAction[]>();
  private enginePromise?: Promise<Engine>;
  private stopped = false;

  constructor(
    private readonly engineResolver: () => Promise<Engine>,
    private readonly options: TelegramGatewayRuntimeOptions,
    private readonly configService: YagrConfigService,
    botToken: string,
    private readonly onboardingToken: string,
  ) {
    this.bot = new Telegraf(botToken);
  }

  async start(): Promise<void> {
    this.bot.start(async (ctx) => {
      const payload = typeof ctx.payload === 'string' ? ctx.payload.trim() : '';
      const chatId = String(ctx.chat.id);

      if (payload !== this.onboardingToken) {
        await ctx.reply('Ce bot n’est pas encore lie a cette conversation. Utilise le QR ou le lien genere par `yagr telegram setup`.');
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

      await ctx.reply('Yagr est maintenant lie a ce chat. Tu peux me parler directement ici.');
    });

    this.bot.command('status', async (ctx) => {
      const chatId = String(ctx.chat.id);
      if (!this.isLinkedChat(chatId)) {
        await ctx.reply('Chat non lie. Utilise le QR ou le lien d’onboarding d’abord.');
        return;
      }

      const linkedChats = this.configService.getLocalConfig().telegram?.linkedChats ?? [];
      await ctx.reply(`Gateway Telegram actif. ${formatLinkedChatCount(linkedChats.length)}.`);
    });

    this.bot.command('pending', async (ctx) => {
      const chatId = String(ctx.chat.id);
      const actions = this.pendingApprovals.get(chatId) ?? [];
      if (actions.length === 0) {
        await ctx.reply('Aucune action en attente.');
        return;
      }

      await ctx.reply(formatRequiredActions(actions));
    });

    this.bot.command('approve', async (ctx) => {
      const chatId = String(ctx.chat.id);
      if (!this.isLinkedChat(chatId)) {
        await ctx.reply('Chat non lie.');
        return;
      }

      const actions = this.pendingApprovals.get(chatId) ?? [];
      if (actions.length === 0) {
        await ctx.reply('Aucune action approuvable en attente.');
        return;
      }

      await this.executeRun(chatId, 'Permission granted. Continue the current task and execute the previously blocked step now.', actions, ctx.reply.bind(ctx));
    });

    this.bot.command('reset', async (ctx) => {
      const chatId = String(ctx.chat.id);
      this.agents.delete(chatId);
      this.pendingApprovals.delete(chatId);
      await ctx.reply('Conversation Yagr reinitialisee pour ce chat.');
    });

    this.bot.command('unlink', async (ctx) => {
      const chatId = String(ctx.chat.id);
      if (!this.isLinkedChat(chatId)) {
        await ctx.reply('Ce chat n’est pas lie.');
        return;
      }

      this.unlinkChat(chatId);
      this.agents.delete(chatId);
      this.pendingApprovals.delete(chatId);
      await ctx.reply('Chat delie. Relance le lien/QR d’onboarding pour te reconnecter.');
    });

    this.bot.on('text', async (ctx) => {
      const chatId = String(ctx.chat.id);
      const text = ctx.message.text.trim();
      if (!text || text.startsWith('/')) {
        return;
      }

      if (ctx.chat.type !== 'private') {
        await ctx.reply('V1 Telegram supporte seulement les chats prives pour le moment.');
        return;
      }

      if (!this.isLinkedChat(chatId)) {
        await ctx.reply('Ce chat n’est pas encore lie. Utilise le QR ou le lien d’onboarding d’abord.');
        return;
      }

      this.touchChat(chatId, ctx.from?.id, ctx.from?.username, ctx.from?.first_name);
      await this.executeRun(chatId, text, [], ctx.reply.bind(ctx));
    });

    await this.bot.launch({ dropPendingUpdates: false });
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    this.bot.stop('Yagr Telegram gateway stopping');
  }

  async reply(chatId: string, message: string): Promise<void> {
    const parts = splitTelegramMessage(message);
    for (const part of parts) {
      await this.bot.telegram.sendMessage(Number(chatId), part);
    }
  }

  private linkChat(chat: YagrTelegramLinkedChat): void {
    this.configService.updateLocalConfig((localConfig) => ({
      ...localConfig,
      telegram: {
        ...localConfig.telegram,
        linkedChats: upsertLinkedChat(localConfig.telegram?.linkedChats ?? [], chat),
      },
    }));
  }

  private unlinkChat(chatId: string): void {
    this.configService.updateLocalConfig((localConfig) => ({
      ...localConfig,
      telegram: {
        ...localConfig.telegram,
        linkedChats: removeLinkedChat(localConfig.telegram?.linkedChats ?? [], chatId),
      },
    }));
  }

  private touchChat(chatId: string, userId?: number, username?: string, firstName?: string): void {
    const current = this.configService.getLocalConfig().telegram?.linkedChats ?? [];
    const existing = current.find((entry) => String(entry.chatId) === String(chatId));
    if (!existing) {
      return;
    }

    this.linkChat({
      ...existing,
      chatId: String(chatId),
      userId: userId ? String(userId) : existing.userId,
      username: username ?? existing.username,
      firstName: firstName ?? existing.firstName,
      lastSeenAt: new Date().toISOString(),
    });
  }

  private isLinkedChat(chatId: string): boolean {
    const linkedChats = this.configService.getLocalConfig().telegram?.linkedChats ?? [];
    return linkedChats.some((entry) => String(entry.chatId) === String(chatId));
  }

  private async getEngine(): Promise<Engine> {
    this.enginePromise ??= this.engineResolver();
    return await this.enginePromise;
  }

  private async getAgent(chatId: string): Promise<YagrAgent> {
    const existing = this.agents.get(chatId);
    if (existing) {
      return existing;
    }

    const next = new YagrAgent(await this.getEngine());
    this.agents.set(chatId, next);
    return next;
  }

  private async executeRun(
    chatId: string,
    prompt: string,
    satisfiedRequiredActions: YagrRequiredAction[],
    reply: (text: string) => Promise<unknown>,
  ): Promise<void> {
    if (this.runningChats.has(chatId)) {
      await reply('Un run est deja en cours pour ce chat. Attends sa fin avant d’envoyer une nouvelle demande.');
      return;
    }

    this.runningChats.add(chatId);
    try {
      await reply('Yagr travaille...');
      const result = await (await this.getAgent(chatId)).run(prompt, {
        ...this.options,
        display: undefined,
        satisfiedRequiredActionIds: satisfiedRequiredActions.map((action) => action.id),
      });

      if (result.requiredActions.length > 0) {
        this.pendingApprovals.set(chatId, result.requiredActions);
      } else {
        this.pendingApprovals.delete(chatId);
      }

      const sections = [result.text.trim()];
      const requiredActionsText = formatRequiredActions(result.requiredActions);
      if (requiredActionsText) {
        sections.push(requiredActionsText);
      }

      const message = sections.filter(Boolean).join('\n\n');
      if (!message) {
        await reply('Run termine, mais aucune reponse textuelle n’a ete produite.');
        return;
      }

      for (const chunk of splitTelegramMessage(message)) {
        await reply(chunk);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await reply(`Run echoue: ${message}`);
    } finally {
      this.runningChats.delete(chatId);
    }
  }
}

export async function runTelegramGateway(
  engineResolver: () => Promise<Engine>,
  options: TelegramGatewayRuntimeOptions = {},
  configService = new YagrConfigService(),
): Promise<void> {
  const runtime = createTelegramGatewayRuntime(engineResolver, options, configService);

  for (const line of runtime.startupMessages) {
    process.stdout.write(`${line}\n`);
  }
  if (runtime.onboardingLink) {
    process.stdout.write(`Onboarding link: ${runtime.onboardingLink}\n`);
    qrcode.generate(runtime.onboardingLink, { small: true });
  }

  await runtime.gateway.start();

  await new Promise<void>((resolve) => {
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