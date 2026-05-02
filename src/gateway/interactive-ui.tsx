import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  buildContextGauge,
  entryToLines,
  formatRequiredAction,
  formatTimestamp,
  normalizeCommandChunk,
  splitStreamingText,
  stateColor,
  type FeedLane,
  type TuiFeedEntry as FeedEntry,
  type TuiRenderLine as RenderLine,
  TuiEmptyState,
  TuiRequiredActionList,
} from '@yagr/tui-surface';
import { SlashCommandService } from '@yagr/conversation-service';
import { SessionService } from '@yagr/session-service';
import type { YagrDeepAgentHandle } from '../agent-factory.js';
import { getYagrDeepAgentSessionsDir, getYagrMemoriesDir } from '../config/yagr-home.js';
import { getGatewayImpactLedger } from './impact.js';
import { createRunAccumulator, processStreamEvent } from './langgraph-events.js';
import type {
  YagrAgentState,
  YagrDisplayOptions,
  YagrOperationEvent,
  YagrRequiredAction,
  YagrRunOptions,
} from '../types.js';

type InteractiveAppProps = {
  agent: YagrDeepAgentHandle['agent'];
  compactionService: YagrDeepAgentHandle['compactionService'];
  threadIdRef: { current: string };
  options: YagrRunOptions;
  sessions: SessionService;
};

function normalizeDisplayOptions(display?: YagrDisplayOptions): Required<YagrDisplayOptions> {
  return {
    showThinking: display?.showThinking ?? true,
    showExecution: display?.showExecution ?? true,
    showResponses: display?.showResponses ?? true,
    showUserPrompts: display?.showUserPrompts ?? true,
  };
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
    <TuiEmptyState
      logo={YAGR_LOGO}
      title="Yagr turns coding intent into local edits."
      subtitle="Type your request below."
    />
  );
}

function RequiredActionList({ actions }: { actions: YagrRequiredAction[] }): JSX.Element {
  return <TuiRequiredActionList actions={actions} />;
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
            impact: {
              ledger: getGatewayImpactLedger(),
              context: { sessionId: threadIdRef.current },
            },
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

    const slashService = new SlashCommandService(sessions, compactionService, getGatewayImpactLedger());
    const parsed = slashService.parse(prompt);

    if (parsed) {
      if (parsed.command === 'exit') {
        app.exit();
        return;
      }

      const ctx = {
        surface: 'tui' as const,
        sessionId: 'default',
        threadId: threadIdRef.current,
      };

      const handler: Parameters<typeof slashService.execute>[2] = {
        getActiveSessionId: () => sessions.getActiveForScope({ kind: 'tui', key: 'default' })?.id,
        resumeSession: (_scope, sessionId) => {
          threadIdRef.current = sessionId;
          setActiveOperationText(`Switched to session: ${sessionId}`);
        },
        resetLocalState: () => {
          setFeed([]);
          setPendingRequiredActions([]);
          seenOperationStartRef.current = new Set();
          seenOperationEndRef.current = new Set();
          operationStateRef.current = new Map();
          resetStreamingBuffers();
          setLastUserPrompt('');
        },
        approvePendingPermissions: () => {
          const permissionActions = pendingRequiredActions.filter((action) => action.kind === 'permission');
          if (permissionActions.length === 0) {
            return 0;
          }
          setPendingRequiredActions((previous) => previous.filter((action) => action.kind !== 'permission'));
          return permissionActions.length;
        },
        getDisplayOptions: () => ({ showThinking: display.showThinking, showExecution: display.showExecution }),
        setDisplayOptions: (opts) => {
          setDisplay((prev) => ({ ...prev, ...opts }));
        },
      };

      const result = await slashService.execute(parsed, ctx, handler);

      if (result.kind === 'ok' && result.data && typeof result.data === 'object' && 'commands' in result.data) {
        pushEntry('result', 'Commands', result.message);
        setActiveOperationText('Use /command to see details.');
      } else if (result.kind === 'ok' && result.message) {
        if (parsed.command === 'help') {
          pushEntry('result', 'Help', result.message);
        } else if (parsed.command === 'sessions') {
          pushEntry('result', 'Sessions', result.message);
        } else if (parsed.command === 'checkpoints') {
          pushEntry('result', 'Checkpoints', result.message);
        } else if (parsed.command === 'impact') {
          pushEntry('result', 'Impact', result.message);
        } else if (parsed.command === 'save') {
          pushEntry('result', 'Checkpoint saved', result.message);
        } else if (parsed.command === 'restore') {
          pushEntry('result', 'Restored', result.message);
        } else if (parsed.command === 'approve') {
          const data = result.data && typeof result.data === 'object' ? result.data : undefined;
          if (data && 'approvedCount' in data && Number(data.approvedCount) > 0) {
            pushEntry('result', 'Permissions', result.message);
            if ('resumePrompt' in data && typeof data.resumePrompt === 'string') {
              await runPrompt(data.resumePrompt);
            }
          } else {
            setActiveOperationText(result.message);
          }
        } else {
          setActiveOperationText(result.message);
        }
      } else {
        pushEntry('interrupt', 'Command error', result.message);
        setActiveOperationText(result.message);
      }

      setInputVersion((previous) => previous + 1);
      return;
    }

    setInputVersion((previous) => previous + 1);
    await runPrompt(prompt);
  }, [agent, app, compactionService, display, expandAllShellBlocks, collapseAllShellBlocks, pendingRequiredActions, pushEntry, resetStreamingBuffers, runPrompt, sessions, threadIdRef]);

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
          <Text color={isRunning ? 'yellow' : stateColor(normalizeTuiState(currentState))}>
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
        /help · /sessions · /impact · /new · /expand · /collapse · /stop · ↑↓ scroll
      </Text>
    </Box>
  );
}

function normalizeTuiState(state: YagrAgentState): 'idle' | 'running' | 'streaming' | 'compacting' | 'completed' | 'waiting' | 'failed' {
  switch (state) {
    case 'waiting_for_permission':
    case 'waiting_for_input':
    case 'resumable':
      return 'waiting';
    case 'failed_terminal':
      return 'failed';
    default:
      return state as 'idle' | 'running' | 'streaming' | 'compacting' | 'completed';
  }
}

export async function runInteractiveGateway(handle: YagrDeepAgentHandle, options: YagrRunOptions): Promise<void> {
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
