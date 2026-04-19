import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { YagrDeepAgentHandle } from '../agent-factory.js';
import { getYagrDeepAgentSessionsDir, getYagrMemoriesDir } from '../config/yagr-home.js';
import { ensureLocalWorkflowOpenBridgeRunning } from './local-open-bridge.js';
import { openExternalUrl } from '../system/open-external.js';
import { createRunAccumulator, processStreamEvent } from './langgraph-events.js';
import { SessionService } from '../session/index.js';
import {
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

type RenderLine = {
  key: string;
  text: string;
  color?: string;
  dimColor?: boolean;
};

type InteractiveAppProps = {
  agent: YagrDeepAgentHandle['agent'];
  compactionService: YagrDeepAgentHandle['compactionService'];
  threadIdRef: { current: string };
  options: YagrRunOptions;
  sessions: SessionService;
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

function buildContextGauge(percent: number, width = 10): string {
  const filled = Math.round((percent / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
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

function entryHeader(entry: FeedEntry): RenderLine {
  return {
    key: `header-${entry.id}`,
    text: `[${entry.timestamp}] ${laneLabel(entry.lane)}${entry.title ? ` · ${entry.title}` : ''}`,
    color: laneColor(entry.lane),
    dimColor: true,
  };
}

function assistantLines(entry: FeedEntry): RenderLine[] {
  const body = entry.text ? entry.text.split('\n') : [];
  return [
    { key: `a-top-${entry.id}`, text: '  ┌─ response', color: 'green' },
    ...body.map((line, i) => ({
      key: `a-${entry.id}-${i}`,
      text: `  │ ${line}`,
      color: 'green',
    })),
    { key: `a-bottom-${entry.id}`, text: '  └─', color: 'green' },
  ];
}

function collapsedShellLines(entry: FeedEntry): RenderLine[] {
  const count = entry.text ? entry.text.split('\n').length : 0;
  return [
    {
      key: `shell-collapsed-${entry.id}`,
      text: `  (${count} lines · use /expand to show all)`,
      dimColor: true,
    },
  ];
}

function expandedShellLines(entry: FeedEntry): RenderLine[] {
  return entry.text.split('\n').map((line, i) => ({
    key: `shell-${entry.id}-${i}`,
    text: `  ${line}`,
    color: entry.emphasis === 'strong' ? laneColor(entry.lane) : undefined,
    dimColor: entry.emphasis !== 'strong',
  }));
}

function entryToLines(entry: FeedEntry): RenderLine[] {
  const lines: RenderLine[] = [entryHeader(entry)];

  if (!entry.text) {
    return lines;
  }

  if (entry.lane === 'assistant') {
    return [...lines, ...assistantLines(entry)];
  }

  if (entry.isShellBlock) {
    return [
      ...lines,
      ...(entry.expanded ? expandedShellLines(entry) : collapsedShellLines(entry)),
    ];
  }

  return [
    ...lines,
    ...entry.text.split('\n').map((line, i) => ({
      key: `entry-${entry.id}-${i}`,
      text: `  ${line}`,
      color: entry.emphasis === 'strong' ? laneColor(entry.lane) : undefined,
      dimColor:
        entry.lane !== 'assistant' &&
        entry.lane !== 'thinking' &&
        entry.emphasis !== 'strong',
    })),
  ];
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

function YagrInteractiveApp({ agent, compactionService, threadIdRef, options, sessions }: InteractiveAppProps) {
  const app = useApp();
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows ?? 24;
  const terminalWidth = stdout?.columns ?? 80;

  const [inputVersion, setInputVersion] = useState(0);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
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
  const [contextFillPercent, setContextFillPercent] = useState<number | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const nextEntryIdRef = useRef(1);
  const assistantBufferRef = useRef('');
  const thinkingBufferRef = useRef('');
  const pendingAssistantTextRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenOperationStartRef = useRef(new Set<string>());
  const seenOperationEndRef = useRef(new Set<string>());
  const operationStateRef = useRef(new Map<string, YagrOperationEvent>());
  const isAutoFollowRef = useRef(true);

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

    setFeed((previous) => [...previous, entry]);

    if (isAutoFollowRef.current) {
      setScrollOffset(0);
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
    pendingAssistantTextRef.current = '';
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
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

  const flushPendingAssistantText = useCallback(() => {
    const text = pendingAssistantTextRef.current;
    pendingAssistantTextRef.current = '';
    flushTimerRef.current = null;
    if (text) {
      setLiveAssistantText(text);
    }
  }, []);

  const appendAssistantDelta = useCallback((delta: string) => {
    assistantBufferRef.current += normalizeCommandChunk(delta);
    pendingAssistantTextRef.current = assistantBufferRef.current;

    if (flushTimerRef.current) {
      return;
    }

    flushTimerRef.current = setTimeout(() => {
      flushPendingAssistantText();
    }, 50);
  }, [flushPendingAssistantText]);

  const finalizeAssistantStream = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const finalText = assistantBufferRef.current.trimEnd();
    if (finalText) {
      pushEntry('assistant', '', finalText);
    }
    assistantBufferRef.current = '';
    pendingAssistantTextRef.current = '';
    setLiveAssistantText('');
  }, [pushEntry]);

  const collapseAllShellBlocks = useCallback(() => {
    setFeed((previous) =>
      previous.map((entry) =>
        entry.isShellBlock ? { ...entry, expanded: false } : entry,
      ),
    );
  }, []);

  const expandAllShellBlocks = useCallback(() => {
    setFeed((previous) =>
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

    const initialContextPercent = Math.min(99, Math.round((prompt.length / 4 / 100000) * 100));
    setContextFillPercent(initialContextPercent);

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
            onCompaction: async (compaction) => {
              await compactionService.notifyCompaction(threadIdRef.current, compaction);
              setActiveOperationText(`Context compacted: ${compaction.messagesCompacted} msgs → ${compaction.preservedRecentMessages} preserved`);
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

      const finalContextPercent = Math.min(100, Math.round(((prompt.length + accumulator.responseText.length) / 4 / 100000) * 100));
      setContextFillPercent(finalContextPercent);
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
  }, [agent, appendAssistantDelta, appendStreamDelta, compactionService, display.showResponses, display.showThinking, display.showUserPrompts, finalizeAssistantStream, flushStreamBuffer, handleOperationEvent, options, pushEntry, resetStreamingBuffers, threadIdRef]);

  const submitPrompt = useCallback(async (rawPrompt: string) => {
    const prompt = rawPrompt.trim();
    if (!prompt) {
      return;
    }

    if (prompt === '/expand') {
      expandAllShellBlocks();
      setActiveOperationText('All shell outputs expanded.');
      setInputVersion((previous) => previous + 1);
      return;
    }

    if (prompt === '/collapse') {
      collapseAllShellBlocks();
      setActiveOperationText('All shell outputs collapsed.');
      setInputVersion((previous) => previous + 1);
      return;
    }

    if (prompt === '/stop') {
      if (isRunning) {
        setActiveOperationText('Stop requested. Finishing current operation...');
      } else {
        setActiveOperationText('Nothing is currently running.');
      }
      setInputVersion((previous) => previous + 1);
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
      try {
        compactionService.reset(threadIdRef.current);
        const newSession = sessions.rotateForScope({ kind: 'tui', key: 'default' }, { title: 'Interactive session' });
        threadIdRef.current = newSession.id;
        setFeed([]);
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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setActiveOperationText(`Reset failed: ${message}`);
      }
      return;
    }

    if (prompt === '/checkpoints') {
      try {
        const checkpoints = await sessions.listCheckpoints(threadIdRef.current);
        if (checkpoints.length === 0) {
          setActiveOperationText('No checkpoints saved for this session.');
        } else {
          pushEntry('result', 'Checkpoints', checkpoints.map((cp, i) => `${i + 1}. ${new Date(cp.createdAt).toLocaleString()} - ${cp.messageCount} msgs`).join('\n'));
          setActiveOperationText(`${checkpoints.length} checkpoint(s). Use /resume <id> to restore.`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setActiveOperationText(`Failed to list checkpoints: ${message}`);
      }
      return;
    }

    if (prompt.startsWith('/resume')) {
      const args = prompt.split(' ').slice(1);
      if (args.length === 0) {
        setActiveOperationText('Usage: /resume <checkpoint_id>. Use /checkpoints to list available checkpoints.');
        return;
      }
      const checkpointId = args[0];
      try {
        const result = await sessions.restoreCheckpoint(threadIdRef.current, checkpointId);
        setFeed([]);
        setPendingRequiredActions([]);
        setWorkflowEmbeds([]);
        seenOperationStartRef.current = new Set();
        seenOperationEndRef.current = new Set();
        operationStateRef.current = new Map();
        if (result.compactionState) {
          compactionService.setState(threadIdRef.current, result.compactionState);
        } else {
          compactionService.reset(threadIdRef.current);
        }
        pushEntry('result', 'Checkpoint restored', `Checkpoint ${checkpointId} has been restored. Feed cleared. Resume your conversation.`);
        setActiveOperationText('Checkpoint restored. Ready for a request.');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setActiveOperationText(`Failed to restore checkpoint: ${message}`);
      }
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
  }, [agent, app, compactionService, handleCompact, isRunning, pendingRequiredActions, pushEntry, runPrompt, sessions, threadIdRef, workflowEmbeds, collapseAllShellBlocks, expandAllShellBlocks]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      app.exit();
      return;
    }

    if (key.upArrow) {
      setScrollOffset(prev => Math.min(prev + 1, Math.max(0, allContentLines.length - contentHeight)));
      isAutoFollowRef.current = false;
      return;
    }

    if (key.downArrow) {
      setScrollOffset(prev => {
        const newOffset = Math.max(prev - 1, 0);
        if (newOffset === 0) {
          isAutoFollowRef.current = true;
        }
        return newOffset;
      });
      return;
    }

    if (key.pageUp) {
      setScrollOffset(prev => Math.min(prev + contentHeight, Math.max(0, allContentLines.length - contentHeight)));
      isAutoFollowRef.current = false;
      return;
    }

    if (key.pageDown) {
      setScrollOffset(prev => {
        const newOffset = Math.max(prev - contentHeight, 0);
        if (newOffset === 0) {
          isAutoFollowRef.current = true;
        }
        return newOffset;
      });
      return;
    }

    if (key.home) {
      setScrollOffset(0);
      isAutoFollowRef.current = true;
      return;
    }

    if (key.end) {
      setScrollOffset(Math.max(0, allContentLines.length - contentHeight));
      isAutoFollowRef.current = false;
      return;
    }

    const mouseWheelUp = input === '\x1b[M' && key.shift;
    const mouseWheelDown = input === '\x1b[M' && key.ctrl;

    if (mouseWheelUp || (input.startsWith('\x1b[M') && input.endsWith('a'))) {
      setScrollOffset(prev => Math.min(prev + 3, Math.max(0, allContentLines.length - contentHeight)));
      isAutoFollowRef.current = false;
      return;
    }

    if (mouseWheelDown || (input.startsWith('\x1b[M') && input.endsWith('b'))) {
      setScrollOffset(prev => {
        const newOffset = Math.max(prev - 3, 0);
        if (newOffset === 0) {
          isAutoFollowRef.current = true;
        }
        return newOffset;
      });
      return;
    }
  }, { isActive: true });

  const idleIcon = currentState === 'completed' ? '●' : currentState === 'failed_terminal' ? '✕' : '○';
  const statusText = isRunning ? activeOperationText : phaseStatusText;
  const latestWorkflow = workflowEmbeds.length > 0 ? workflowEmbeds[workflowEmbeds.length - 1] : undefined;
  const latestWorkflowOpenUrl = latestWorkflow ? resolveTerminalWorkflowOpenUrl(latestWorkflow) : undefined;

  const headerHeight = feed.length === 0 ? 12 : 1;
  const statusHeight = 1;
  const separatorHeight = 1;
  const inputHeight = 1;
  const hintsHeight = 1;
  const footerPadding = 1;

  const reservedHeight =
    headerHeight +
    statusHeight +
    separatorHeight +
    inputHeight +
    hintsHeight +
    footerPadding;

  const contentHeight = Math.max(1, terminalHeight - reservedHeight);

  const allContentLines = useMemo(() => {
    return feed.flatMap(entry => entryToLines(entry));
  }, [feed]);

  const maxScrollOffset = Math.max(0, allContentLines.length - contentHeight);

  const visibleContentLines = useMemo(() => {
    const effectiveOffset = Math.min(scrollOffset, maxScrollOffset);
    const start = Math.max(0, allContentLines.length - contentHeight - effectiveOffset);
    return allContentLines.slice(start, start + contentHeight);
  }, [allContentLines, contentHeight, scrollOffset, maxScrollOffset]);

  const isAtBottom = scrollOffset === 0;
  const isAtTop = scrollOffset >= maxScrollOffset;

  return (
    <Box flexDirection="column" height={terminalHeight} width="100%">
      {feed.length === 0 ? (
        <EmptyState />
      ) : (
        <Box>
          <Text color="cyan" bold>YAGR</Text>
        </Box>
      )}

      <Box flexDirection="column" flexGrow={1}>
        {visibleContentLines.map(line => (
          <Text
            key={line.key}
            color={line.color}
            dimColor={line.dimColor}
            wrap="truncate-end"
          >
            {line.text}
          </Text>
        ))}
      </Box>

      <Text dimColor>{"─".repeat(Math.min(terminalWidth - 2, 80))}</Text>

      <Box justifyContent="space-between">
        <Text color={isRunning ? 'yellow' : stateColor(currentState)}>
          {isRunning ? `${loadingDots} ${statusText}` : `${idleIcon} ${statusText}`}
        </Text>
        {contextFillPercent != null ? (
          <Text dimColor={contextFillPercent < 60} color={contextFillPercent >= 80 ? 'red' : contextFillPercent >= 60 ? 'yellow' : undefined}>
            [{buildContextGauge(contextFillPercent)}] {Math.round(contextFillPercent)}%
          </Text>
        ) : !isAtBottom && allContentLines.length > contentHeight ? (
          <Text dimColor>
            {isAutoFollowRef.current ? '↓ auto' : `↑↓ ${maxScrollOffset - scrollOffset + contentHeight}/${allContentLines.length}`}
          </Text>
        ) : null}
      </Box>

      {liveThinkingLine ? <Text color="magenta">Thinking: {liveThinkingLine}</Text> : null}
      {liveAssistantText ? <Text color="green">Assistant: {liveAssistantText}</Text> : null}
      {pendingRequiredActions.length > 0 ? <RequiredActionList actions={pendingRequiredActions} /> : null}

      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="green">› </Text>
        <TextInput
          key={`prompt-input-${inputVersion}`}
          onSubmit={(value) => {
            void submitPrompt(value);
          }}
          placeholder={isRunning ? 'Draft your next message...' : 'Describe what you want to automate'}
        />
      </Box>

      <Text dimColor>
        {latestWorkflowOpenUrl
          ? '/expand · /collapse · /open · /stop · ↑↓ scroll'
          : '/expand · /collapse · /stop · ↑↓ scroll'}
      </Text>
    </Box>
  );
}

export async function runInteractiveGateway(handle: YagrDeepAgentHandle, options: YagrRunOptions): Promise<void> {
  await ensureLocalWorkflowOpenBridgeRunning();
  const sessions = new SessionService({
    sessionsDir: getYagrDeepAgentSessionsDir(),
    memoriesDir: getYagrMemoriesDir(),
  });
  sessions.setCheckpointer(handle.checkpointer);
  const session = sessions.getOrCreateForScope({ kind: 'tui', key: 'default' }, { title: 'Interactive session' });
  const threadIdRef = { current: session.id };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ink = render(<YagrInteractiveApp agent={handle.agent} compactionService={handle.compactionService} threadIdRef={threadIdRef} options={options} sessions={sessions} />, {
    exitOnCtrlC: false,
    alternateScreen: true,
  } as any);

  await ink.waitUntilExit();
}
