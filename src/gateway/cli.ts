import { runInteractiveGateway } from './interactive-ui.js';
import { extractLastAiMessage } from './langgraph-events.js';
import type { YagrDeepAgentHandle } from '../agent-factory.js';
import type { YagrRunOptions } from '../types.js';
import { getYagrDeepAgentSessionsDir, getYagrMemoriesDir } from '../config/yagr-home.js';
import { SessionService } from '@yagr/session-service';

export interface CliGatewayOptions extends YagrRunOptions {
  prompt?: string;
  interactive?: boolean;
}

export async function runCliGateway(handle: YagrDeepAgentHandle, options: CliGatewayOptions = {}): Promise<void> {
  if (options.prompt && !options.interactive) {
    const sessions = new SessionService({
      sessionsDir: getYagrDeepAgentSessionsDir(),
      memoriesDir: getYagrMemoriesDir(),
    });
    sessions.setCheckpointer(handle.checkpointer);
    const session = sessions.create({ title: 'CLI prompt' });
    const result = await handle.agent.invoke(
      { messages: [{ role: 'user', content: options.prompt }] },
      sessions.buildSessionConfig(session.id),
    ) as Record<string, unknown>;
    process.stdout.write(`${extractLastAiMessage(result)}\n`);
    return;
  }

  await runInteractiveGateway(handle, options);
}
