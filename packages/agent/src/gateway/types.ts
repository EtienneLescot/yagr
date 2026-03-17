export type GatewaySurface = 'telegram' | 'webui' | 'whatsapp';

export interface Gateway {
  start(): Promise<void>;
  stop(): Promise<void>;
  reply(chatId: string, message: string): Promise<void>;
}

export interface GatewayRuntimeHandle {
  gateway: Gateway;
  startupMessages: string[];
  onboardingLink?: string;
}

export interface InboundMessage {
  chatId: string;
  userId: string;
  text: string;
  source: 'telegram' | 'web' | 'cli' | 'api' | 'whatsapp';
  metadata?: Record<string, unknown>;
}