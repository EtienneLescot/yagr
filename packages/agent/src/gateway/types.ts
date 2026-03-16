export interface Gateway {
  start(): Promise<void>;
  stop(): Promise<void>;
  reply(chatId: string, message: string): Promise<void>;
}

export interface InboundMessage {
  chatId: string;
  userId: string;
  text: string;
  source: 'telegram' | 'web' | 'cli' | 'api';
  metadata?: Record<string, unknown>;
}