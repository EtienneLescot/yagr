/**
 * Yagr deep-agent factory.
 *
 * Wraps `createDeepAgent` from the `deepagents` / LangGraph library with
 * Yagr-specific wiring:
 *
 *   - `LocalShellBackend` — actual filesystem I/O + shell execution
 *     (provides `ls`, `read_file`, `write_file`, `edit_file`, `glob`,
 *      `grep`, `execute` as native tools)
 *   - Yagr-specific tools injected on top (httpRequest, requestRequiredAction,
 *     reportProgress, moveFile, deleteFile, presentWorkflowResult, yagrProxy)
 *   - `MemorySaver` checkpointer so per-thread (=per-session) state is
 *     maintained within the process lifetime
 *   - System prompt built from the current engine / config / workspace context
 *
 * Usage:
 *   const agentHandle = await createYagrDeepAgent(engine, configService);
 *   // agentHandle.agent is a CompiledStateGraph — call streamEvents / invoke
 *   // with { configurable: { thread_id: sessionId } }
 */
import { createDeepAgent, LocalShellBackend } from 'deepagents';
import { MemorySaver } from '@langchain/langgraph';
import type { StructuredTool } from '@langchain/core/tools';
import type { EngineRuntimePort } from './engine/engine.js';
import type { YagrConfigStoreLike } from './config/yagr-config-service.js';
import { createLangChainModel } from './llm/create-langchain-model.js';
import { buildSystemPrompt } from './prompt/build-system-prompt.js';
import {
  httpRequestTool,
  requestRequiredActionTool,
  reportProgressTool,
  moveFileTool,
  deleteFileTool,
} from './tools/langchain/index.js';
import {
  presentWorkflowResultTool,
  yagrProxyTool,
} from './manager-tooling/langchain/index.js';

/** Returned by `createYagrDeepAgent`. */
export interface YagrDeepAgentHandle {
  /** The compiled LangGraph agent — call `streamEvents` or `invoke`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: ReturnType<typeof createDeepAgent>;
  /** The checkpointer — shared across calls so per-thread state persists. */
  checkpointer: MemorySaver;
}

/**
 * Build the list of Yagr-specific tools injected into the deep agent.
 * Tools already provided by `FilesystemMiddleware` + `LocalShellBackend`
 * (ls, read_file, write_file, edit_file, glob, grep, execute) are NOT
 * included here to avoid duplication.
 */
function buildYagrTools(): StructuredTool[] {
  return [
    httpRequestTool as StructuredTool,
    requestRequiredActionTool as StructuredTool,
    reportProgressTool as StructuredTool,
    moveFileTool as StructuredTool,
    deleteFileTool as StructuredTool,
    presentWorkflowResultTool as StructuredTool,
    yagrProxyTool as StructuredTool,
  ];
}

/**
 * Instantiate a Yagr-configured deep agent.
 *
 * This should be called once per active engine instance.  When the engine
 * is invalidated (e.g. n8n config change), discard the handle and call this
 * again; the new handle will use a fresh checkpointer so session history
 * starts over — matching the current behaviour where `agents.clear()` is
 * called on config change.
 */
export async function createYagrDeepAgent(
  engine: EngineRuntimePort,
  configStore?: YagrConfigStoreLike,
): Promise<YagrDeepAgentHandle> {
  const model = await createLangChainModel(configStore);
  const systemPrompt = buildSystemPrompt(engine);
  const checkpointer = new MemorySaver();

  const agent = createDeepAgent({
    model,
    tools: buildYagrTools(),
    systemPrompt,
    checkpointer,
    backend: new LocalShellBackend({
      rootDir: process.cwd(),
      inheritEnv: true,
    }),
  });

  return { agent, checkpointer };
}
