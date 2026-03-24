import { randomBytes } from 'node:crypto';
import qrcode from 'qrcode-terminal';
import { Telegraf } from 'telegraf';
import { YagrSessionAgent } from '../agent.js';
import { YagrConfigService, type YagrTelegramLinkedChat } from '../config/yagr-config-service.js';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import type { EngineRuntimePort } from '../engine/engine.js';
import { resolveLanguageModelConfig } from '../llm/create-language-model.js';
import { YagrSetupApplicationService } from '../setup/application-services.js';
import type { YagrRequiredAction, YagrRunOptions } from '../types.js';
import {
  mapPhaseEventToUserVisibleUpdate,
  mapStateEventToUserVisibleUpdate,
  mapToolEventToUserVisibleUpdate,
  type YagrUserVisibleUpdate,
} from '../runtime/user-visible-updates.js';
import {
  type WorkflowEmbed,
  buildWorkflowBannerHtml,
  extractWorkflowEmbed,
  markdownToTelegramHtml,
  escapeHtml,
} from './format-message.js';
import type { Gateway, GatewayRuntimeHandle } from './types.js';

const TELEGRAM_MESSAGE_LIMIT = 4096;

function formatTelegramProgressHtml(update: YagrUserVisibleUpdate): string {
  const title = escapeHtml(update.title);
  const detail = update.detail ? escapeHtml(update.detail) : '';
  return detail ? `<b>${title}</b>\n${detail}` : `<b>${title}</b>`;
}

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

export async function resolveTelegramBotIdentity(botToken: string): Promise<{ username: string; firstName: string }> {
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
  const currentToken = configService.getTelegramBotToken() ?? '';
  const setupService = new YagrSetupApplicationService(configService, new YagrN8nConfigService(), {
    resolveTelegramIdentity: resolveTelegramBotIdentity,
    createOnboardingToken,
  });

  if (!currentToken) {
    process.stdout.write(`\nTo create a Telegram bot token:\n${buildTelegramTokenInstructions()}\n`);
  }

  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let botToken: string;
  try {
    if (currentToken) {
      const answer = await rl.question(`Reuse saved token? [Y/n] `);
      botToken = answer.trim().toLowerCase() === 'n' ? await rl.question('Telegram bot token: ') : currentToken;
    } else {
      botToken = await rl.question('Telegram bot token: ');
    }
  } finally {
    rl.close();
  }

  if (!botToken.includes(':')) throw new Error('Invalid Telegram bot token format.');

  process.stdout.write('Verifying token...\n');
  const identity = await setupService.configureTelegram(botToken);
  const nextConfig = configService.getLocalConfig();

  const deepLink = buildTelegramDeepLink(
    nextConfig.telegram?.botUsername ?? identity.username,
    nextConfig.telegram?.onboardingToken ?? createOnboardingToken(),
  );

  process.stdout.write(`\nTelegram bot ready: @${identity.username}\nOnboarding link: ${deepLink}\n`);
  qrcode.generate(deepLink, { small: true });
  process.stdout.write('Gateway saved. Start with `yagr gateway start`.\n');
}

export function showTelegramOnboarding(configService = new YagrConfigService()): void {
  const status = new YagrSetupApplicationService(configService, new YagrN8nConfigService()).getTelegramStatus();

  if (!status.configured || !status.botUsername || !status.deepLink) {
    throw new Error('Telegram is not configured. Run `yagr telegram setup` first.');
  }

  process.stdout.write(
    [
      '',
      `Bot: @${status.botUsername}`,
      `Onboarding link: ${status.deepLink}`,
      `Linked chats: ${formatLinkedChatCount(status.linkedChats.length)}`,
      '',
      'Scan the QR or open the link, then press Start in Telegram.',
      '',
    ].join('\n'),
  );
  qrcode.generate(status.deepLink, { small: true });
}

export function getTelegramGatewayStatus(configService = new YagrConfigService()): TelegramGatewayStatus {
  return new YagrSetupApplicationService(configService, new YagrN8nConfigService()).getTelegramStatus();
}

export function resetTelegramGateway(configService = new YagrConfigService()): void {
  new YagrSetupApplicationService(configService, new YagrN8nConfigService()).resetTelegram();
}

export function createTelegramGatewayRuntime(
  engineResolver: () => Promise<EngineRuntimePort>,
  options: TelegramGatewayRuntimeOptions = {},
  configService = new YagrConfigService(),
): GatewayRuntimeHandle {
  const setupService = new YagrSetupApplicationService(configService, new YagrN8nConfigService());
  const { status, botToken, onboardingToken } = setupService.getTelegramRuntimeConfig(options.botToken);

  if (!botToken || !status.botUsername || !onboardingToken) {
    throw new Error('Telegram is not configured. Run `yagr telegram setup` first.');
  }

  const linkedCount = status.linkedChats.length;

  return {
    gateway: new TelegramGateway(engineResolver, options, configService, botToken, onboardingToken),
    startupMessages: [
      `Yagr Telegram gateway listening as @${status.botUsername}. ${formatLinkedChatCount(linkedCount)}.`,
      linkedCount === 0
        ? `Aucun chat lié. Lien d'onboarding : ${status.deepLink}`
        : 'Telegram transport is ready. The current orchestrator connection will be resolved on first message.',
    ],
    onboardingLink: status.deepLink && linkedCount === 0 ? status.deepLink : undefined,
  };
}

class TelegramGateway implements Gateway {
  private readonly bot: Telegraf;
  private readonly agents = new Map<string, YagrSessionAgent>();
  private readonly runningChats = new Set<string>();
  private readonly pendingApprovals = new Map<string, YagrRequiredAction[]>();
  private enginePromise?: Promise<EngineRuntimePort>;
  private stopped = false;
  private readonly setupService: YagrSetupApplicationService;

  constructor(
    private readonly engineResolver: () => Promise<EngineRuntimePort>,
    private readonly options: TelegramGatewayRuntimeOptions,
    private readonly configService: YagrConfigService,
    botToken: string,
    private readonly onboardingToken: string,
  ) {
    this.bot = new Telegraf(botToken);
    this.setupService = new YagrSetupApplicationService(configService, new YagrN8nConfigService());
  }

  private buildDeepLink(): string {
    const botUsername = this.setupService.getTelegramStatus().botUsername ?? '';
    return buildTelegramDeepLink(botUsername, this.onboardingToken);
  }

  async start(): Promise<void> {
    this.bot.start(async (ctx) => {
      const payload = typeof ctx.payload === 'string' ? ctx.payload.trim() : '';
      const chatId = String(ctx.chat.id);

      if (payload !== this.onboardingToken) {
        const deepLink = this.buildDeepLink();
        await ctx.reply(
          `Ce lien est invalide ou expiré. Clique sur le lien ci-dessous pour lier ce chat, puis appuie sur Démarrer :\n${deepLink}`,
        );
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
        const deepLink = this.buildDeepLink();
        await ctx.reply(
          `Chat non lié. Clique sur le lien ci-dessous puis appuie sur Démarrer :\n${deepLink}`,
        );
        return;
      }

      const linkedChats = this.setupService.getLinkedTelegramChats();
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

    this.bot.command('link', async (ctx) => {
      if (this.isLinkedChat(String(ctx.chat.id))) {
        await ctx.reply('Ce chat est déjà lié à Yagr. Tu peux me parler directement.');
        return;
      }

      const deepLink = this.buildDeepLink();
      await ctx.reply(
        `Pour lier ce chat, clique sur le lien ci-dessous puis appuie sur Démarrer :\n${deepLink}`,
      );
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
        const deepLink = this.buildDeepLink();
        await ctx.reply(
          `Ce chat n'est pas lié. Clique sur le lien ci-dessous pour le lier :\n${deepLink}`,
        );
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
        await ctx.reply('Telegram supporte seulement les chats prives pour le moment.');
        return;
      }

      if (!this.isLinkedChat(chatId)) {
        const deepLink = this.buildDeepLink();
        await ctx.reply(
          `Ce chat n'est pas encore lié. Clique sur le lien ci-dessous puis appuie sur Démarrer :\n${deepLink}`,
        );
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
    await new Promise<void>((resolve, reject) => {
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

  private async sendHtml(chatId: string, html: string): Promise<void> {
    const parts = splitTelegramMessage(html);
    for (const part of parts) {
      try {
        await this.bot.telegram.sendMessage(Number(chatId), part, { parse_mode: 'HTML' });
      } catch {
        // Fallback to plain text if HTML parsing fails
        await this.bot.telegram.sendMessage(Number(chatId), part);
      }
    }
  }

  private linkChat(chat: YagrTelegramLinkedChat): void {
    this.setupService.linkTelegramChat(chat);
  }

  private unlinkChat(chatId: string): void {
    this.setupService.unlinkTelegramChat(chatId);
  }

  private touchChat(chatId: string, userId?: number, username?: string, firstName?: string): void {
    this.setupService.touchTelegramChat(chatId, userId, username, firstName);
  }

  private isLinkedChat(chatId: string): boolean {
    return this.setupService.isTelegramChatLinked(chatId);
  }

  private async getEngine(): Promise<EngineRuntimePort> {
    this.enginePromise ??= this.engineResolver();
    return await this.enginePromise;
  }

  private async getAgent(chatId: string): Promise<YagrSessionAgent> {
    const existing = this.agents.get(chatId);
    if (existing) {
      return existing;
    }

    const next = new YagrSessionAgent(await this.getEngine());
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

      let lastProgressKey = '';
      const sendProgressUpdate = async (update: YagrUserVisibleUpdate | undefined): Promise<void> => {
        if (!update || update.dedupeKey === lastProgressKey) {
          return;
        }

        lastProgressKey = update.dedupeKey;
        await this.sendHtml(chatId, formatTelegramProgressHtml(update));
      };

      const embeds: WorkflowEmbed[] = [];
      const resolvedConfig = resolveLanguageModelConfig({}, this.configService);
      const result = await (await this.getAgent(chatId)).run(prompt, {
        ...this.options,
        provider: resolvedConfig.provider,
        model: resolvedConfig.model,
        apiKey: resolvedConfig.apiKey,
        baseUrl: resolvedConfig.baseUrl,
        display: undefined,
        satisfiedRequiredActionIds: satisfiedRequiredActions.map((action) => action.id),
        onPhaseChange: async (event) => {
          await sendProgressUpdate(mapPhaseEventToUserVisibleUpdate(event));
          await this.options.onPhaseChange?.(event);
        },
        onStateChange: async (event) => {
          await sendProgressUpdate(mapStateEventToUserVisibleUpdate(event));
          await this.options.onStateChange?.(event);
        },
        onToolEvent: async (event) => {
          const embed = extractWorkflowEmbed(event);
          if (embed) embeds.push(embed);
          await sendProgressUpdate(mapToolEventToUserVisibleUpdate(event));
          await this.options.onToolEvent?.(event);
        },
      });

      if (result.requiredActions.length > 0) {
        this.pendingApprovals.set(chatId, result.requiredActions);
      } else {
        this.pendingApprovals.delete(chatId);
      }

      const htmlSections = [markdownToTelegramHtml(result.text.trim())];
      const workflowBanner = buildWorkflowBannerHtml(embeds);
      if (workflowBanner) {
        htmlSections.push(workflowBanner);
      }
      const requiredActionsText = formatRequiredActions(result.requiredActions);
      if (requiredActionsText) {
        htmlSections.push(escapeHtml(requiredActionsText));
      }

      const htmlMessage = htmlSections.filter(Boolean).join('\n\n');
      if (!htmlMessage) {
        await reply('Run termine, mais aucune reponse textuelle n’a ete produite.');
        return;
      }

      await this.sendHtml(chatId, htmlMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await reply(`Run echoue: ${message}`);
    } finally {
      this.runningChats.delete(chatId);
    }
  }
}

export async function runTelegramGateway(
  engineResolver: () => Promise<EngineRuntimePort>,
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
