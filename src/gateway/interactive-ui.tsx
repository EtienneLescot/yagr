import { Box, Static, Text, render, useApp, useInput, useStdout } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { YagrDeepAgentHandle } from '../agent-factory.js';
import { getYagrDeepAgentSessionsDir } from '../config/yagr-home.js';
import { ensureLocalWorkflowOpenBridgeRunning } from './local-open-bridge.js';
import { openExternalUrl } from '../system/open-external.js';
import { createRunAccumulator, processStreamEvent } from './langgraph-events.js';
import { DeepAgentSessionStore } from '../session/deepagent-sessions.js';
import {
  formatTerminalLink,
  formatWorkflowLinkTerminal,
  type WorkflowEmbed,
  resolveTerminalWorkflowOpenUrl,
  workflowEmbedKey,
} from './format-message.js';
import type {
  YagrAgentState,
  YagrDisplayOptions,
  YagrOperationEvent,
  YagrRequiredAction,
  YagrRunOptions,
} from '../types.js';

type FeedLane = 'user' | 'assistant' | 'thinking' | 'action' | 'result' | 'interrupt';

type FeedEntry = {
  id: number;
  lane: FeedLane;
  title: string;
  text: string;
  timestamp: string;
  emphasis?: 'normal' | 'strong';
  expanded?: boolean;
  isShellBlock?: boolean;
};

type InteractiveAppProps = {
  agent: YagrDeepAgentHandle['agent'];
  threadIdRef: { current: string };
  options: YagrRunOptions;
  createSessionId: () => string;
};

function stateColor(state: YagrAgentState): string {
  switch (state) {
    case 'idle': return 'cyan';
    case 'running':
    case 'streaming':
    case 'compacting': return 'yellow';
    case 'completed': return 'green';
    case 'waiting_for_permission':
    case 'waiting_for_input':
    case 'resumable': return 'magenta';
    case 'failed_terminal': return 'red';
    default: return 'white';
  }
}

function laneColor(lane: FeedLane): string {
  switch (lane) {
    case 'user': return 'cyan';
    case 'assistant': return 'green';
    case 'thinking': return 'magenta';
    case 'action': return 'yellow';
    case 'result': return 'green';
    case 'interrupt': return 'red';
  }
}

function laneLabel(lane: FeedLane): string {
  switch (lane) {
    case 'user': return 'You';
    case 'assistant': return 'Assistant';
    case 'thinking': return 'Thinking';
    case 'action': return 'Action';
    case 'result': return 'Result';
    case 'interrupt': return 'Blocked';
  }
}

function normalizeDisplayOptions(display?: YagrDisplayOptions): Required<YagrDisplayOptions> {
  return {
    showThinking: display?.showThinking ?? true,
    showExecution: display?.showExecution ?? true,
    showResponses: display?.showResponses ?? true,
    showUserPrompts: display?.showUserPrompts ?? true,
  };
}

function normalizeCommandChunk(chunk: string): string {
  return chunk.replace(/\r+/g, '\n');
}

function splitStreamingText(text: string, flushAll = false): { emitted: string; remainder: string } {
  const normalized = normalizeCommandChunk(text);
  if (flushAll) {
    return { emitted: normalized, remainder: '' };
  }

  const lines = normalized.split('\n');
  if (lines.length <= 1) {
    return { emitted: '', remainder: normalized };
  }

  return {
    emitted: lines.slice(0, -1).join('\n'),
    remainder: lines.at(-1) ?? '',
  };
}

function formatRequiredAction(action: YagrRequiredAction): string {
  const detail = action.detail ? ` ${action.detail}` : '';
  const blockingLabel = action.blocking === false ? ' follow-up' : '';
  return `${action.title} [${action.kind}]${action.resumable ? ' resumable' : ''}${blockingLabel}: ${action.message}.${detail}`;
}

function formatTimestamp(date = new Date()): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

const YAGR_LOGO = `

██████         █████
█▒▒▒▒▒██     █▓▒▒▒▓█
 █▓▒▒▒▒▒█  █▓▒▒▒▓▓██
   █▓▒▒▒▒▒▓▒▒▒▓▓██  
     █▒▒▒▒▒▒▓▓█     
      ██▒▒▓▓██      
       █▒▒▓▓██      
       █▒▒▓▓██      
       ███████      
`;

function EmptyState(): JSX.Element {
  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>{YAGR_LOGO}</Text>
      <Box marginTop={1} />
      <Text color="cyan" bold>Yagr turns an intent into executable automation.</Text>
      <Text dimColor>Type your request below.</Text>
    </Box>
  );
}

function RequiredActionList({ actions }: { actions: YagrRequiredAction[] }): JSX.Element {
  const hasBlocking = actions.some((a) => a.blocking !== false);
  return (
    <Box flexDirection="column" marginTop={1}>
      {hasBlocking
        ? <Text color="red" bold>Run blocked</Text>
        : <Text color="yellow" bold>Follow-up actions</Text>}
      <Text dimColor>{hasBlocking ? 'Yagr is waiting for a user action before it can continue cleanly.' : 'These actions are optional but recommended.'}</Text>
      <Box flexDirection="column" marginTop={1}>
        {actions.map((action) => (
          <Box key={action.id} flexDirection="column" marginBottom={1}>
            <Text color={action.kind === 'permission' ? 'yellow' : action.blocking === false ? 'cyan' : 'red'} bold>{action.title}</Text>
            <Text>{formatRequiredAction(action)}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function YagrInteractiveApp({ agent, threadIdRef, options, createSessionId }: InteractiveAppProps) {
  const app = useApp();
  const { stdout } = useStdout();
  const [inputVersion, setInputVersion] = useState(0);
  const [historyFeed, setHistoryFeed] = useState<FeedEntry[]>([]);
  const [shellFeed, setShellFeed] = useState<FeedEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentState, setCurrentState] = useState<YagrAgentState>('idle');
  const [phaseStatusText, setPhaseStatusText] = useState('Ready.');
  const [display, setDisplay] = useState<Required<YagrDisplayOptions>>(() => normalizeDisplayOptions(options.display));
  const [liveAssistantText, setLiveAssistantText] = useState('');
  const [liveThinkingLine, setLiveThinkingLine] = useState('');
  const [pendingRequiredActions, setPendingRequiredActions] = useState<YagrRequiredAction[]>([]);
  const [lastUserPrompt, setLastUserPrompt] = useState('');
  const [activeOperationText, setActiveOperationText] = useState('Ready for a request.');
  const [workflowEmbeds, setWorkflowEmbeds] = useState<WorkflowEmbed[]>([]);
  const [loadingDots, setLoadingDots] = useState('');
  const nextEntryIdRef = useRef(1);
  const assistantBufferRef = useRef('');
  const thinkingBufferRef = useRef('');
  const seenOperationStartRef = useRef(new Set<string>());
  const seenOperationEndRef = useRef(new Set<string>());
  const operationStateRef = useRef(new Map<string, YagrOperationEvent>());

  const pushEntry = useCallback((
    lane: FeedLane,
    title: string,
    text = '',
    emphasis: FeedEntry['emphasis'] = 'normal',
    expanded = false,
    isShellBlock = false,
  ): number => {
    const id = nextEntryIdRef.current++;
    const entry: FeedEntry = {
      id,
      lane,
      title,
      text,
      timestamp: formatTimestamp(),
      emphasis,
      expanded,
      isShellBlock,
    };

    if (isShellBlock) {
      setShellFeed((previous) => [...previous, entry]);
    } else {
      setHistoryFeed((previous) => [...previous, entry]);
    }

    return id;
  }, []);

  const flushStreamBuffer = useCallback((
    lane: FeedLane,
    bufferRef: { current: string },
    setLive: (value: string) => void,
    flushAll = false,
  ) => {
    const { emitted, remainder } = splitStreamingText(bufferRef.current, flushAll);
    bufferRef.current = remainder;
    setLive(remainder);

    if (emitted.trim()) {
      pushEntry(lane, '', emitted);
    }
  }, [pushEntry]);

  const appendStreamDelta = useCallback((
    lane: FeedLane,
    delta: string,
    bufferRef: { current: string },
    setLive: (value: string) => void,
  ) => {
    bufferRef.current += normalizeCommandChunk(delta);
    flushStreamBuffer(lane, bufferRef, setLive, false);
  }, [flushStreamBuffer]);

  const resetStreamingBuffers = useCallback(() => {
    assistantBufferRef.current = '';
    thinkingBufferRef.current = '';
    setLiveAssistantText('');
    setLiveThinkingLine('');
  }, []);

  useEffect(() => {
    if (!isRunning) {
      setLoadingDots('');
      return;
    }

    const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
    let frame = 0;

    const interval = setInterval(() => {
      setLoadingDots(frames[frame % frames.length]);
      frame++;
    }, 80);

    return () => clearInterval(interval);
  }, [isRunning]);

  const appendAssistantDelta = useCallback((delta: string) => {
    assistantBufferRef.current += normalizeCommandChunk(delta);
    setLiveAssistantText(assistantBufferRef.current);
  }, []);

  const finalizeAssistantStream = useCallback(() => {
    const finalText = assistantBufferRef.current.trimEnd();
    if (finalText) {
      pushEntry('assistant', '', finalText);
    }
    assistantBufferRef.current = '';
    setLiveAssistantText('');
  }, [pushEntry]);

  const collapseAllShellBlocks = useCallback(() => {
    setShellFeed((previous) =>
      previous.map((entry) =>
        entry.isShellBlock ? { ...entry, expanded: false } : entry,
      ),
    );
  }, []);

  const expandAllShellBlocks = useCallback(() => {
    setShellFeed((previous) =>
      previous.map((entry) =>
        entry.isShellBlock ? { ...entry, expanded: true } : entry,
      ),
    );
  }, []);

  const handleOperationEvent = useCallback((op: YagrOperationEvent) => {
    const previous = operationStateRef.current.get(op.operationId);
    const merged = previous ? { ...previous, ...op } : op;
    operationStateRef.current.set(op.operationId, merged);
    setActiveOperationText(merged.label);

    if (merged.category === 'thinking') {
      if (!display.showThinking) {
        return;
      }

      if (!seenOperationStartRef.current.has(merged.operationId)) {
        seenOperationStartRef.current.add(merged.operationId);
        pushEntry('thinking', `◐ ${merged.label}`);
      }

      if ((merged.status === 'done' || merged.status === 'error') && !seenOperationEndRef.current.has(merged.operationId)) {
        flushStreamBuffer('thinking', thinkingBufferRef, setLiveThinkingLine, true);
        if (merged.summary) {
          pushEntry('thinking', `● ${merged.label}`, merged.summary);
        }
        seenOperationEndRef.current.add(merged.operationId);
      }
      return;
    }

    if (!display.showExecution) {
      return;
    }

    if (!seenOperationStartRef.current.has(merged.operationId)) {
      seenOperationStartRef.current.add(merged.operationId);
      pushEntry('action', `◐ ${merged.label}`);
    }

    if ((merged.status === 'done' || merged.status === 'error') && !seenOperationEndRef.current.has(merged.operationId)) {
      const parts: string[] = [];
      if (merged.category !== 'file-read' && merged.body?.trim()) {
        parts.push(normalizeCommandChunk(merged.body).trimEnd());
      }
      if (merged.summary?.trim()) {
        parts.push(merged.summary.trim());
      }
      const entryId = pushEntry(
        merged.status === 'error' ? 'interrupt' : 'action',
        `${merged.status === 'error' ? '✕' : '●'} ${merged.label}`,
        parts.join('\n\n'),
        merged.status === 'error' ? 'strong' : 'normal',
        false,
        true,
      );
      seenOperationEndRef.current.add(merged.operationId);
    }
  }, [display.showExecution, display.showThinking, flushStreamBuffer, pushEntry]);

  const handleCompact = useCallback(() => {
    setActiveOperationText('Compaction is handled automatically by Yagr.');
  }, [setActiveOperationText]);

  const runPrompt = useCallback(async (prompt: string) => {
    setLastUserPrompt(prompt);

    if (display.showUserPrompts) {
      pushEntry('user', 'Request', prompt);
    }

    setIsRunning(true);
    setCurrentState('running');
    setPhaseStatusText('Analyzing...');
    setActiveOperationText('Analyzing the workspace and constraints.');
    resetStreamingBuffers();
    setWorkflowEmbeds([]);
    seenOperationStartRef.current = new Set();
    seenOperationEndRef.current = new Set();
    operationStateRef.current = new Map();

    const accumulator = createRunAccumulator();

    try {
      const stream = agent.streamEvents(
        { messages: [{ role: 'user', content: prompt }] },
        { configurable: { thread_id: threadIdRef.current }, version: 'v2' },
      );

      const DEBUG_STREAM = process.env.DEBUG_AGENT_STREAM === '1';
      let eventCount = 0;

      try {
        for await (const event of stream) {
          eventCount++;
          if (DEBUG_STREAM) {
            const eventType = 'event' in event ? (event.event as string) : 'unknown';
            const eventName = 'name' in event ? (event.name as string) : 'unknown';
            console.error(`[DEBUG_AGENT_STREAM] #${eventCount} event=${eventType} name=${eventName}`);
          }
          await processStreamEvent(event, accumulator, {
            onTextDelta: async (delta) => {
              if (display.showResponses) {
                appendAssistantDelta(delta);
              }
              await options.onTextDelta?.(delta);
            },
            onThinkingDelta: async (delta) => {
              if (display.showThinking) {
                appendStreamDelta('thinking', delta, thinkingBufferRef, setLiveThinkingLine);
              }
            },
            onOperation: async (op) => {
              handleOperationEvent(op);
            },
            onUserVisibleUpdate: async (update) => {
              if (update.tone === 'error') {
                pushEntry('interrupt', update.title, update.detail ?? update.title, 'strong');
              }
              setPhaseStatusText(update.title);
              if (update.detail) setActiveOperationText(update.detail);
            },
            onWorkflowEmbed: async (embed) => {
              const w: WorkflowEmbed = {
                workflowId: embed.workflowId,
                url: embed.url,
                targetUrl: embed.targetUrl,
                title: embed.title,
                diagram: embed.diagram,
                executionResult: embed.executionResult,
              };
              setWorkflowEmbeds((prev) => (
                prev.some((entry) => workflowEmbedKey(entry) === workflowEmbedKey(w))
                  ? prev
                  : [...prev, w]
              ));
              pushEntry('result', 'Workflow available', formatWorkflowLinkTerminal(w), 'strong');
              setActiveOperationText(`Workflow ready: ${w.targetUrl ?? w.url}`);
            },
          });
        }
        if (DEBUG_STREAM) {
          console.error(`[DEBUG_AGENT_STREAM] Stream finished normally. eventCount=${eventCount}`);
        }
      } catch (streamError) {
        if (DEBUG_STREAM) {
          console.error(`[DEBUG_AGENT_STREAM] Stream error:`, streamError);
        }
        throw streamError;
      }

      if (display.showResponses) {
        finalizeAssistantStream();
      }
      if (display.showThinking) {
        flushStreamBuffer('thinking', thinkingBufferRef, setLiveThinkingLine, true);
      }
      const finalState: YagrAgentState = accumulator.requiredActions.length > 0 ? 'waiting_for_input' : 'completed';
      setCurrentState(finalState);
      setPendingRequiredActions(accumulator.requiredActions);

      if (accumulator.requiredActions.length > 0) {
        for (const action of accumulator.requiredActions) {
          pushEntry('interrupt', 'Action required', formatRequiredAction(action));
        }
        setPhaseStatusText(accumulator.requiredActions[0].message);
        setActiveOperationText(accumulator.requiredActions[0].message);
      } else {
        setPhaseStatusText('Ready.');
        setActiveOperationText('Run finished. Ready for the next request.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushEntry('interrupt', 'Run failed', message);
      resetStreamingBuffers();
      setCurrentState('failed_terminal');
      setPhaseStatusText('Run failed.');
      setActiveOperationText(message);
    } finally {
      setIsRunning(false);
    }
  }, [agent, appendAssistantDelta, appendStreamDelta, display.showResponses, display.showThinking, display.showUserPrompts, finalizeAssistantStream, flushStreamBuffer, handleOperationEvent, options, pushEntry, resetStreamingBuffers, threadIdRef]);

  const submitPrompt = useCallback(async (rawPrompt: string) => {
    const prompt = rawPrompt.trim();
    if (!prompt) {
      return;
    }

    if (prompt === '/expand') {
      expandAllShellBlocks();
      setActiveOperationText('All shell outputs expanded.');
      return;
    }

    if (prompt === '/collapse') {
      collapseAllShellBlocks();
      setActiveOperationText('All shell outputs collapsed.');
      return;
    }

    if (prompt === '/stop') {
      if (isRunning) {
        setActiveOperationText('Stop requested. Finishing current operation...');
      } else {
        setActiveOperationText('Nothing is currently running.');
      }
      return;
    }

    if (isRunning) {
      setActiveOperationText('Current run still in progress. Wait before sending a new message.');
      return;
    }

    setInputVersion((previous) => previous + 1);

    if (prompt === '/exit' || prompt === '/quit') {
      app.exit();
      return;
    }

    if (prompt === '/reset') {
      threadIdRef.current = createSessionId();
      setHistoryFeed([]);
      setShellFeed([]);
      setPendingRequiredActions([]);
      setCurrentState('idle');
      setPhaseStatusText('Conversation reset.');
      resetStreamingBuffers();
      setLastUserPrompt('');
      setActiveOperationText('Ready for a request.');
      setWorkflowEmbeds([]);
      seenOperationStartRef.current = new Set();
      seenOperationEndRef.current = new Set();
      operationStateRef.current = new Map();
      return;

    }

    if (prompt === '/toggle-thinking' || prompt === '/toggle-agent-thinking') {
      setDisplay((previous) => ({ ...previous, showThinking: !previous.showThinking }));
      return;
    }

    if (prompt === '/toggle-cli' || prompt === '/toggle-command-executions') {
      setDisplay((previous) => ({ ...previous, showExecution: !previous.showExecution }));
      return;
    }

    if (prompt === '/pending') {
      if (pendingRequiredActions.length === 0) {
        setActiveOperationText('No required actions pending.');
      } else {
        for (const action of pendingRequiredActions) {
          pushEntry('interrupt', 'Pending', formatRequiredAction(action));
        }
      }
      return;
    }

    if (prompt === '/open') {
      const latestEmbed = workflowEmbeds[workflowEmbeds.length - 1];
      if (!latestEmbed) {
        setActiveOperationText('No recent workflow to open.');
        return;
      }

      try {
        await openExternalUrl(resolveTerminalWorkflowOpenUrl(latestEmbed));
        pushEntry('result', 'Opened workflow', latestEmbed.targetUrl ?? latestEmbed.url);
        setActiveOperationText(`Workflow opened: ${latestEmbed.targetUrl ?? latestEmbed.url}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushEntry('interrupt', 'Workflow open failed', message);
        setActiveOperationText(`Workflow open failed: ${message}`);
      }
      return;
    }

    if (prompt.startsWith('/approve')) {
      const permissionActions = pendingRequiredActions.filter((action) => action.kind === 'permission');
      if (permissionActions.length === 0) {
        setActiveOperationText('No permissions pending.');
        return;
      }

      setPendingRequiredActions((previous) => previous.filter((action) => action.kind !== 'permission'));
      pushEntry('result', 'Permissions', `Permission granted for ${permissionActions.length} action(s).`);
      await runPrompt('Permission granted. Continue the current task and execute the previously blocked step now.');
      return;
    }

    if (prompt === '/compact') {
      handleCompact();
      return;
    }

    await runPrompt(prompt);
  }, [agent, app, handleCompact, isRunning, pendingRequiredActions, pushEntry, runPrompt, workflowEmbeds, collapseAllShellBlocks, expandAllShellBlocks]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      app.exit();
    }
  }, { isActive: true });

  const terminalWidth = stdout?.columns ?? process.stdout.columns ?? 100;

  const idleIcon = currentState === 'completed' ? '●' : currentState === 'failed_terminal' ? '✕' : '○';
  const statusText = isRunning ? activeOperationText : phaseStatusText;
  const latestWorkflow = workflowEmbeds.length > 0 ? workflowEmbeds[workflowEmbeds.length - 1] : undefined;
  const latestWorkflowOpenUrl = latestWorkflow ? resolveTerminalWorkflowOpenUrl(latestWorkflow) : undefined;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0} width="100%">
      <Static items={historyFeed}>
        {(entry) => (
          <Box key={entry.id} flexDirection="column" marginBottom={0}>
            <Text color={laneColor(entry.lane)} dimColor>
              [{entry.timestamp}] {laneLabel(entry.lane)}{entry.title ? ` · ${entry.title}` : ''}
            </Text>
            {entry.text && entry.lane === 'assistant' ? (
              <Box flexDirection="column">
                <Text color="green">{'  '}┌─ response</Text>
                {entry.text.split('\n').map((line, i) => (
                  <Text key={i} color="green">{'  '}│ {line}</Text>
                ))}
                <Text color="green">{'  '}└─</Text>
              </Box>
            ) : entry.text ? (
              entry.text.split('\n').map((line, i) => (
                <Text
                  // eslint-disable-next-line react/no-array-index-key
                  key={i}
                  color={entry.emphasis === 'strong' ? laneColor(entry.lane) : undefined}
                  dimColor={entry.lane !== 'assistant' && entry.lane !== 'thinking' && entry.emphasis !== 'strong'}
                >
                  {'  '}{line}
                </Text>
              ))
            ) : null}
          </Box>
        )}
      </Static>

      {shellFeed.map(entry => (
        <Box key={entry.id} flexDirection="column" marginBottom={0}>
          <Text color={laneColor(entry.lane)} dimColor>
            [{entry.timestamp}] {laneLabel(entry.lane)}{entry.title ? ` · ${entry.title}` : ''}
          </Text>
          {entry.text
            ? entry.expanded
              ? entry.text.split('\n').map((line, i) => (
                  <Text
                    // eslint-disable-next-line react/no-array-index-key
                    key={i}
                    color={entry.emphasis === 'strong' ? laneColor(entry.lane) : undefined}
                    dimColor={entry.emphasis !== 'strong'}
                  >
                    {'  '}{line}
                  </Text>
                ))
              : <Text dimColor>{'  '}({entry.text.split('\n').length} lines · use /expand to show all)</Text>
            : null}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>{"─".repeat(Math.min(terminalWidth - 2, 80))}</Text>
      </Box>

      {historyFeed.length === 0 && shellFeed.length === 0 && !isRunning && pendingRequiredActions.length === 0 ? <EmptyState /> : null}

      <Box flexDirection="column" marginTop={1}>
        <Text color={isRunning ? 'yellow' : stateColor(currentState)}>
          {isRunning ? `${loadingDots} ${statusText}` : `${idleIcon} ${statusText}`}
        </Text>
        {isRunning ? <Text color="yellow">Enter is disabled while the agent is still working. You can keep typing and send once the run finishes.</Text> : null}
        {liveThinkingLine ? <Text color="magenta">Thinking: {liveThinkingLine}</Text> : null}
        {liveAssistantText ? <Text color="green">Assistant: {liveAssistantText}</Text> : null}
        {pendingRequiredActions.length > 0 ? <RequiredActionList actions={pendingRequiredActions} /> : null}
        <Text dimColor>
          {latestWorkflowOpenUrl
            ? '/expand · /collapse · /open · /stop'
            : '/expand · /collapse · /stop'}
        </Text>
      </Box>

      <Box borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
        <Text color="green">› </Text>
        <TextInput
          key={`prompt-input-${inputVersion}`}
          onSubmit={(value) => {
            void submitPrompt(value);
          }}
          placeholder={isRunning ? 'Draft your next message. Press Enter when the current run finishes.' : 'Describe what you want to automate'}
        />
      </Box>
    </Box>
  );
}

export async function runInteractiveGateway(handle: YagrDeepAgentHandle, options: YagrRunOptions): Promise<void> {
  await ensureLocalWorkflowOpenBridgeRunning();
  const sessionStore = new DeepAgentSessionStore(getYagrDeepAgentSessionsDir());
  const createSessionId = () => sessionStore.create({ title: 'Interactive session' }).id;
  const session = { id: createSessionId() };
  const threadIdRef = { current: session.id };
  const ink = render(<YagrInteractiveApp agent={handle.agent} threadIdRef={threadIdRef} options={options} createSessionId={createSessionId} />, {
    exitOnCtrlC: false,
  });

  await ink.waitUntilExit();
}
