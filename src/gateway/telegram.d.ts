import { YagrConfigService, type YagrConfigStoreLike, type YagrTelegramLinkedChat } from '../config/yagr-config-service.js';
import type { YagrRunOptions } from '../types.js';
import type { GatewayRuntimeHandle } from './types.js';
export declare function createOnboardingToken(): string;
export declare function buildTelegramDeepLink(botUsername: string, onboardingToken: string): string;
export declare function upsertLinkedChat(chats: YagrTelegramLinkedChat[], nextChat: YagrTelegramLinkedChat): YagrTelegramLinkedChat[];
export declare function removeLinkedChat(chats: YagrTelegramLinkedChat[], chatId: string): YagrTelegramLinkedChat[];
export declare function splitTelegramMessage(text: string, limit?: number): string[];
interface TelegramGatewayRuntimeOptions extends YagrRunOptions {
    botToken?: string;
}
export interface TelegramGatewayStatus {
    configured: boolean;
    botUsername?: string;
    linkedChats: YagrTelegramLinkedChat[];
    deepLink?: string;
}
export declare function resolveTelegramBotIdentity(botToken: string): Promise<{
    username: string;
    firstName: string;
}>;
export declare function setupTelegramGateway(configService?: YagrConfigService): Promise<void>;
export declare function showTelegramOnboarding(configService?: YagrConfigService): void;
export declare function getTelegramGatewayStatus(configService?: YagrConfigStoreLike): TelegramGatewayStatus;
export declare function resetTelegramGateway(configService?: YagrConfigService): void;
export declare function createTelegramGatewayRuntime(options?: TelegramGatewayRuntimeOptions, configService?: YagrConfigService): GatewayRuntimeHandle;
export declare function runTelegramGateway(options?: TelegramGatewayRuntimeOptions, configService?: YagrConfigService): Promise<void>;
export {};
//# sourceMappingURL=telegram.d.ts.map