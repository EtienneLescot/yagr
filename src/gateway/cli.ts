import { randomUUID } from 'node:crypto';
import { runInteractiveGateway } from './interactive-ui.js';
import { extractLastAiMessage } from './langgraph-events.js';
import type { YagrDeepAgentHandle } from '../agent-factory.js';
import type { YagrRunOptions } from '../types.js';

export interface CliGatewayOptions extends YagrRunOptions {
  prompt?: string;
  interactive?: boolean;
}

export async function runCliGateway(handle: YagrDeepAgentHandle, options: CliGatewayOptions = {}): Promise<void> {
  if (options.prompt && !options.interactive) {
    const threadId = randomUUID();
    const result = await handle.agent.invoke(
      { messages: [{ role: 'user', content: options.prompt }] },
      { configurable: { thread_id: threadId } },
    ) as Record<string, unknown>;
    process.stdout.write(`${extractLastAiMessage(result)}\n`);
    return;
  }

  await runInteractiveGateway(handle, options);
}
