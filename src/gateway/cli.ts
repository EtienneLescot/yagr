import { runInteractiveGateway } from './interactive-ui.js';
import { extractLastAiMessage } from './langgraph-events.js';
import type { YagrDeepAgentHandle } from '../agent-factory.js';
import type { YagrRunOptions } from '../types.js';
import { getYagrDeepAgentSessionsDir } from '../config/yagr-home.js';
import { buildDeepAgentSessionConfig, DeepAgentSessionStore } from '../session/deepagent-sessions.js';

export interface CliGatewayOptions extends YagrRunOptions {
  prompt?: string;
  interactive?: boolean;
}

export async function runCliGateway(handle: YagrDeepAgentHandle, options: CliGatewayOptions = {}): Promise<void> {
  if (options.prompt && !options.interactive) {
    const sessionStore = new DeepAgentSessionStore(getYagrDeepAgentSessionsDir());
    const session = sessionStore.create({ title: 'CLI prompt' });
    const result = await handle.agent.invoke(
      { messages: [{ role: 'user', content: options.prompt }] },
      buildDeepAgentSessionConfig(session.id),
    ) as Record<string, unknown>;
    process.stdout.write(`${extractLastAiMessage(result)}\n`);
    return;
  }

  await runInteractiveGateway(handle, options);
}
