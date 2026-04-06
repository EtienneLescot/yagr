import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type { YagrDeepAgentHandle } from '../agent-factory.js';
import { getYagrN8nWorkspaceDir } from '../config/yagr-home.js';
import { ensureLocalWorkflowOpenBridgeRunning } from './local-open-bridge.js';
import { openExternalUrl } from '../system/open-external.js';
import { createRunAccumulator, processStreamEvent } from './langgraph-events.js';
import {
  type WorkflowEmbed,
  buildWorkflowBannerTerminal,
  resolveTerminalWorkflowOpenUrl,
  workflowEmbedKey,
} from './format-message.js';
import type {
  YagrAgentState,
  YagrDisplayOptions,
  YagrOperationEvent,
  YagrPhaseEvent,
  YagrRequiredAction,
  YagrRunOptions,
} from '../types.js';

type FeedLane = 'user' | 'result' | 'interrupt';

type FeedEntry = {
  id: number;
  lane: FeedLane;
  title: string;
  text: string;
  timestamp: string;
  emphasis?: 'normal' | 'strong';
};

type HistoryLine = {
  id: string;
  text: string;
  color?: string;
  dimColor?: boolean;
};

type InteractiveAppProps = {
  agent: YagrDeepAgentHandle['agent'];
  threadIdRef: { current: string };
  options: YagrRunOptions;
};

const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];
const BAR_WIDTH = 16;
const BAR_CYCLE = (BAR_WIDTH - 1) * 2; // 30 ticks per back-and-forth
const PULSE_CYCLE = BAR_CYCLE * SPINNER_FRAMES.length; // 120 — LCM of both animations

const ACTIVITY_PHASES: Array<YagrPhaseEvent['phase']> = [
  'inspect', 'plan', 'edit', 'summarize',
];

function buildActivityBar(pulse: number): string {
  const pos = pulse % BAR_CYCLE;
  const ballPos = pos <= BAR_WIDTH - 1 ? pos : BAR_CYCLE - pos;
  return Array.from({ length: BAR_WIDTH }, (_, i) => {
    const dist = Math.abs(i - ballPos);
    if (dist === 0) return '█';
    if (dist === 1) return '▓';
    if (dist === 2) return '▒';
    if (dist === 3) return '░';
    return '─';
  }).join('');
}

function phaseLabel(phase: YagrPhaseEvent['phase'] | null): string {
  switch (phase) {
    case 'inspect': return 'Inspect';
    case 'plan': return 'Plan';
    case 'edit': return 'Edit';
    case 'summarize': return 'Summary';
    default: return 'Waiting';
  }
}

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
    case 'result': return 'green';
    case 'interrupt': return 'red';
  }
}

function laneLabel(lane: FeedLane): string {
  switch (lane) {
    case 'user': return 'You';
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

function buildContextBar(fillPercent: number): string {
  const TOTAL = 10;
  const filled = Math.round(Math.max(0, Math.min(100, fillPercent)) / 100 * TOTAL);
  return `[${'█'.repeat(filled)}${'░'.repeat(TOTAL - filled)}]`;
}

function buildCommandHistoryText(command: string, stdout: string, stderr: string, exitCode: number, message?: string): string {
  const sections = [`$ ${command}`];

  if (stdout.trimEnd()) {
    sections.push(`stdout\n${stdout.trimEnd()}`);
  }

  if (stderr.trimEnd()) {
    sections.push(`stderr\n${stderr.trimEnd()}`);
  }

  sections.push(`exit ${exitCode}${message ? ` ${message}` : ''}`);
  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Operation-to-history flattening (for Ctrl+Y view)
// ---------------------------------------------------------------------------

function flattenOperationsToHistoryLines(
  operations: YagrOperationEvent[],
  feedEntries: FeedEntry[],
): HistoryLine[] {
  const lines: HistoryLine[] = [];

  // First emit feed entries (user prompts, final responses, interrupts)
  for (const entry of feedEntries) {
    lines.push({
      id: `feed:${entry.id}:header`,
      text: `[${entry.timestamp}] ${laneLabel(entry.lane)} · ${entry.title}`,
      color: laneColor(entry.lane),
    });
    const bodyLines = entry.text.split('\n');
    for (let i = 0; i < bodyLines.length; i++) {
      lines.push({
        id: `feed:${entry.id}:body:${i}`,
        text: bodyLines[i].length > 0 ? `  ${bodyLines[i]}` : ' ',
        color: entry.emphasis === 'strong' ? laneColor(entry.lane) : undefined,
        dimColor: entry.lane !== 'result',
      });
    }
    lines.push({ id: `feed:${entry.id}:spacer`, text: ' ', dimColor: true });
  }

  // Then emit each operation in order
  for (const op of operations) {
    const elapsed = op.endedAt ? ` · ${((op.endedAt - op.startedAt) / 1000).toFixed(1)}s` : '';
    const statusIcon = op.status === 'done' ? '●' : op.status === 'error' ? '✕' : '◐';
    lines.push({
      id: `op:${op.operationId}:header`,
      text: `${statusIcon} ${op.label}${elapsed}`,
      color: opColor(op),
    });
    if (op.body) {
      const bodyLines = op.body.split('\n');
      for (let i = 0; i < bodyLines.length; i++) {
        lines.push({
          id: `op:${op.operationId}:body:${i}`,
          text: `  ${bodyLines[i]}`,
          dimColor: op.category === 'thinking',
        });
      }
    }
    lines.push({ id: `op:${op.operationId}:spacer`, text: ' ', dimColor: true });
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Operation card helpers
// ---------------------------------------------------------------------------

function opCategoryPrefix(category: YagrOperationEvent['category']): string {
  switch (category) {
    case 'shell': return 'Shell ';
    case 'file-read': return 'Read ';
    case 'file-write': return 'Write ';
    case 'web': return 'Web ';
    case 'agent': return 'Agent ';
    case 'phase': return '';
    case 'thinking': return '';
    default: return '';
  }
}

function opColor(op: YagrOperationEvent): string {
  if (op.status === 'error') return 'red';
  if (op.category === 'thinking') return 'magenta';
  if (op.category === 'phase') return 'cyan';
  if (op.category === 'shell') return op.status === 'running' ? 'yellow' : 'green';
  if (op.category === 'file-read' || op.category === 'file-write') return op.status === 'running' ? 'yellow' : 'blue';
  if (op.category === 'web') return op.status === 'running' ? 'yellow' : 'cyan';
  return op.status === 'running' ? 'yellow' : 'white';
}

function OperationCard({ op }: { op: YagrOperationEvent }): JSX.Element {
  const icon = op.status === 'done' ? '●' : op.status === 'error' ? '✕' : '◐';
  const color = opColor(op);
  const elapsed = op.endedAt ? `  ${((op.endedAt - op.startedAt) / 1000).toFixed(1)}s` : '';

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box>
        <Text color={color}>{icon} </Text>
        <Text bold={op.status === 'running'} color={color}>{truncateText(op.label, 80)}</Text>
        {elapsed ? <Text dimColor>{elapsed}</Text> : null}
      </Box>
      {op.summary && op.status !== 'running' ? (
        <Box paddingLeft={2}>
          <Text dimColor>{truncateText(op.summary, 100)}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function OperationList({ operations }: { operations: YagrOperationEvent[] }): JSX.Element {
  if (operations.length === 0) {
    return <Text dimColor>Yagr is working…</Text>;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {operations.map((op) => (
        <OperationCard key={op.operationId} op={op} />
      ))}
    </Box>
  );
}

function Panel({
  title,
  subtitle,
  color,
  children,
  width = '100%',
}: {
  title: string;
  subtitle?: string;
  color: string;
  children: ReactNode;
  width?: number | string;
}): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} paddingY={0} width={width}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text color={color} bold>{title}</Text>
        {subtitle ? <Text dimColor>{subtitle}</Text> : <Text dimColor> </Text>}
      </Box>
      <Box flexDirection="column">{children}</Box>
    </Box>
  );
}

function ActiveRunIndicator({
  phase,
  statusText,
  pulse,
}: {
  phase: YagrPhaseEvent['phase'] | null;
  statusText: string;
  pulse: number;
}): JSX.Element {
  const spinnerChar = SPINNER_FRAMES[pulse % SPINNER_FRAMES.length];
  const phaseIndex = phase ? ACTIVITY_PHASES.indexOf(phase) : -1;
  const bar = buildActivityBar(pulse);
  const dots = ACTIVITY_PHASES.map((_, i) => {
    if (phaseIndex < 0) return '◇';
    if (i < phaseIndex) return '◉';
    if (i === phaseIndex) return '◆';
    return '◇';
  }).join(' ');
  const phaseName = phase ? phaseLabel(phase) : '';

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="yellow" bold>{spinnerChar} </Text>
        <Text bold>{truncateText(statusText, 80)}</Text>
      </Box>
      <Box>
        <Text dimColor>  ╰ </Text>
        <Text color="cyan">{bar}</Text>
        {phaseIndex >= 0 && (
          <Text dimColor>  {phaseName} ({phaseIndex + 1}/{ACTIVITY_PHASES.length})</Text>
        )}
      </Box>
      <Box>
        <Text dimColor>      {dots}</Text>
      </Box>
    </Box>
  );
}

function EmptyState(): JSX.Element {
  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>Yagr turns an intent into executable automation.</Text>
      <Text dimColor>Normal mode: one area for what is happening, one area for the prompt.</Text>
      <Text dimColor>History mode: Ctrl+Y shows the full transcript as plain text.</Text>
    </Box>
  );
}

function RequiredActionCard({ actions }: { actions: YagrRequiredAction[] }): JSX.Element {
  const hasBlocking = actions.some((a) => a.blocking !== false);
  return (
    <Box flexDirection="column">
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

// ---------------------------------------------------------------------------
// TerminalMarkdown: light markdown rendering for assistant responses
// ---------------------------------------------------------------------------

type MdSegment =
  | { kind: 'heading'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'bullet'; text: string };

function parseMarkdownSegments(md: string): MdSegment[] {
  const segments: MdSegment[] = [];
  const lines = md.split('\n');
  let inCode = false;
  const codeBuf: string[] = [];

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        segments.push({ kind: 'code', text: codeBuf.join('\n') });
        codeBuf.length = 0;
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    const trimmed = line.trimStart();
    if (/^#{1,6}\s/.test(trimmed)) {
      segments.push({ kind: 'heading', text: trimmed.replace(/^#{1,6}\s+/, '') });
    } else if (/^[-*]\s/.test(trimmed)) {
      segments.push({ kind: 'bullet', text: trimmed.replace(/^[-*]\s+/, '') });
    } else {
      segments.push({ kind: 'text', text: line });
    }
  }
  if (codeBuf.length > 0) {
    segments.push({ kind: 'code', text: codeBuf.join('\n') });
  }
  return segments;
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function TerminalMarkdown({ text }: { text: string }): JSX.Element {
  const segments = useMemo(() => parseMarkdownSegments(text), [text]);

  return (
    <Box flexDirection="column">
      {segments.map((seg, i) => {
        switch (seg.kind) {
          case 'heading':
            return <Text key={i} color="green" bold>{stripInlineMarkdown(seg.text)}</Text>;
          case 'code':
            return (
              <Box key={i} marginLeft={2} marginY={0}>
                <Text color="gray">{seg.text}</Text>
              </Box>
            );
          case 'bullet':
            return <Text key={i} color="green">  • {stripInlineMarkdown(seg.text)}</Text>;
          default:
            return <Text key={i} color="green">{stripInlineMarkdown(seg.text)}</Text>;
        }
      })}
    </Box>
  );
}

function WorkflowBanner({ embeds }: { embeds: WorkflowEmbed[] }): JSX.Element | null {
  if (embeds.length === 0) return null;

  const execEmbed = embeds.find(e => e.executionResult);
  const exec = execEmbed?.executionResult;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>{buildWorkflowBannerTerminal(embeds)}</Text>
      {exec ? (
        <Box flexDirection="column" marginTop={1} paddingLeft={1} borderLeft={true} borderStyle="single" borderColor={exec.status === 'success' ? 'green' : exec.status === 'error' ? 'red' : 'yellow'}>
          <Text bold color={exec.status === 'success' ? 'green' : exec.status === 'error' ? 'red' : 'yellow'}>
            {exec.status === 'success' ? '✓ Exécution réussie' : exec.status === 'error' ? '✗ Erreur d\'exécution' : '⧗ En attente'}
            {exec.executionId ? ` · #${exec.executionId}` : ''}
          </Text>
          {exec.summary ? <Text>{exec.summary}</Text> : null}
          {exec.data ? <Text dimColor>{exec.data}</Text> : null}
        </Box>
      ) : null}
    </Box>
  );
}

function YagrInteractiveApp({ agent, threadIdRef, options }: InteractiveAppProps) {
  const app = useApp();
  const { stdout } = useStdout();
  const [inputVersion, setInputVersion] = useState(0);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  /** Operation cards indexed by operationId (ordered insertion). */
  const [operations, setOperations] = useState<Map<string, YagrOperationEvent>>(new Map());
  const [isRunning, setIsRunning] = useState(false);
  const [currentState, setCurrentState] = useState<YagrAgentState>('idle');
  const [currentPhase, setCurrentPhase] = useState<YagrPhaseEvent['phase'] | null>(null);
  const [phaseStatusText, setPhaseStatusText] = useState('Ready.');
  const [display, setDisplay] = useState<Required<YagrDisplayOptions>>(() => normalizeDisplayOptions(options.display));
  const [liveAssistantText, setLiveAssistantText] = useState('');
  const [latestAssistantText, setLatestAssistantText] = useState('');
  const [pendingRequiredActions, setPendingRequiredActions] = useState<YagrRequiredAction[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lastUserPrompt, setLastUserPrompt] = useState('');
  const [statusPulse, setStatusPulse] = useState(0);
  const [activeOperationText, setActiveOperationText] = useState('Ready for a request.');
  const [workflowEmbeds, setWorkflowEmbeds] = useState<WorkflowEmbed[]>([]);
  const [contextFillPercent, setContextFillPercent] = useState<number | null>(null);
  const nextEntryIdRef = useRef(1);
  const workspaceLabel = useMemo(() => basename(getYagrN8nWorkspaceDir()), []);

  const upsertOperation = useCallback((op: YagrOperationEvent) => {
    setOperations((prev) => {
      const next = new Map(prev);
      const existing = next.get(op.operationId);
      next.set(op.operationId, existing ? { ...existing, ...op } : op);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }

    const timer = setInterval(() => {
      setStatusPulse((previous) => (previous + 1) % PULSE_CYCLE);
    }, 80);

    return () => clearInterval(timer);
  }, [isRunning]);

  const pushEntry = useCallback((lane: FeedLane, title: string, text: string, emphasis: FeedEntry['emphasis'] = 'normal') => {
    if (!text.trim()) {
      return;
    }

    setFeed((previous) => [
      ...previous,
      {
        id: nextEntryIdRef.current += 1,
        lane,
        title,
        text,
        timestamp: formatTimestamp(),
        emphasis,
      },
    ]);
  }, []);

  const finalizeAssistantEntry = useCallback((finalText: string) => {
    const resolvedText = finalText.trim();
    setLiveAssistantText('');

    if (!resolvedText) {
      return;
    }

    setLatestAssistantText(resolvedText);
    if (display.showResponses) {
      pushEntry('result', 'Final response', resolvedText, 'strong');
    }
  }, [display.showResponses, pushEntry]);

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
    setCurrentPhase('inspect');
    setPhaseStatusText('Analyzing...');
    setActiveOperationText('Analyzing the workspace and constraints.');
    setLiveAssistantText('');
    setWorkflowEmbeds([]);
    setContextFillPercent(null);
    setOperations(new Map());

    const accumulator = createRunAccumulator();

    try {
      const stream = agent.streamEvents(
        { messages: [{ role: 'user', content: prompt }] },
        { configurable: { thread_id: threadIdRef.current }, version: 'v2' },
      );

      for await (const event of stream) {
        await processStreamEvent(event, accumulator, {
          onTextDelta: async (delta) => {
            if (display.showResponses) {
              setLiveAssistantText((previous) => `${previous}${delta}`);
            }
            await options.onTextDelta?.(delta);
          },
          onThinkingDelta: async (_delta) => {
            // Thinking text is surfaced via onOperation — no additional action needed.
          },
          onOperation: async (op) => {
            if (op.category === 'thinking' && !display.showThinking) return;
            upsertOperation(op);
            setActiveOperationText(op.label);
          },
          onUserVisibleUpdate: async (update) => {
            // Keep for error/interrupt entries and phase text.
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
            const label = w.title ? `${w.title} — ${w.url}` : w.url;
            pushEntry('result', 'Workflow available', label, 'strong');
            setActiveOperationText(`Workflow ready: ${w.url}`);
          },
        });
      }

      finalizeAssistantEntry(accumulator.responseText);
      const finalState: YagrAgentState = accumulator.requiredActions.length > 0 ? 'waiting_for_input' : 'completed';
      setCurrentState(finalState);
      setCurrentPhase(null);
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
      setLiveAssistantText('');
      setCurrentState('failed_terminal');
      setCurrentPhase(null);
      setPhaseStatusText('Run failed.');
      setActiveOperationText(message);
    } finally {
      setIsRunning(false);
    }
  }, [agent, threadIdRef, display.showResponses, display.showThinking, display.showUserPrompts, finalizeAssistantEntry, options, pushEntry]);

  const submitPrompt = useCallback(async (rawPrompt: string) => {
    const prompt = rawPrompt.trim();
    if (!prompt || isRunning) {
      return;
    }

    setInputVersion((previous) => previous + 1);

    if (prompt === '/exit' || prompt === '/quit') {
      app.exit();
      return;
    }

    if (prompt === '/reset') {
      threadIdRef.current = randomUUID();
      setFeed([]);
      setPendingRequiredActions([]);
      setCurrentState('idle');
      setCurrentPhase(null);
      setPhaseStatusText('Conversation reset.');
      setLiveAssistantText('');
      setLatestAssistantText('');
      setLastUserPrompt('');
      setActiveOperationText('Ready for a request.');
      setWorkflowEmbeds([]);
      setOperations(new Map());
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

    if (prompt === '/history' || prompt === '/toggle-history') {
      setHistoryOpen((previous) => !previous);
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
  }, [agent, app, handleCompact, isRunning, pendingRequiredActions, pushEntry, runPrompt, workflowEmbeds]);

  useInput((inputKey, key) => {
    if (key.ctrl && inputKey === 'c') {
      app.exit();
      return;
    }

    if (key.ctrl && inputKey === 'y') {
      setHistoryOpen((previous) => !previous);
      return;
    }

    if (key.ctrl && inputKey.toLowerCase() === 'o' && workflowEmbeds.length > 0 && !isRunning) {
      const latestEmbed = workflowEmbeds[workflowEmbeds.length - 1];
      if (!latestEmbed) {
        return;
      }

      void openExternalUrl(resolveTerminalWorkflowOpenUrl(latestEmbed))
        .then(() => {
          pushEntry('result', 'Opened workflow', latestEmbed.targetUrl ?? latestEmbed.url);
          setActiveOperationText(`Workflow opened: ${latestEmbed.targetUrl ?? latestEmbed.url}`);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          pushEntry('interrupt', 'Workflow open failed', message);
          setActiveOperationText(`Workflow open failed: ${message}`);
        });
      return;
    }

    if (key.escape && historyOpen) {
      setHistoryOpen(false);
    }
  }, { isActive: true });

  const operationList = useMemo(() => [...operations.values()], [operations]);
  const historyLines = useMemo(
    () => flattenOperationsToHistoryLines(operationList, feed),
    [operationList, feed],
  );
  /** Visible cards in the Working panel: last 6, excluding thinking if showThinking=false. */
  const visibleOperations = useMemo(
    () => operationList
      .filter((op) => op.category !== 'thinking' || display.showThinking)
      .slice(-6),
    [operationList, display.showThinking],
  );
  const terminalWidth = stdout?.columns ?? process.stdout.columns ?? 100;
  const headerSubtitle = useMemo(() => {
    if (!lastUserPrompt) {
      return 'Interactive session';
    }

    return truncateText(lastUserPrompt.replace(/\s+/g, ' ').trim(), Math.max(24, Math.floor(terminalWidth * 0.65)));
  }, [lastUserPrompt, terminalWidth]);

  const hasBlockingActions = pendingRequiredActions.some((a) => a.blocking !== false);
  const idleIcon = currentState === 'completed' ? '●' : currentState === 'failed_terminal' ? '✕' : '○';
  const statusText = isRunning ? activeOperationText : phaseStatusText;
  const latestWorkflowTarget = workflowEmbeds.length > 0 ? (workflowEmbeds[workflowEmbeds.length - 1]?.targetUrl ?? workflowEmbeds[workflowEmbeds.length - 1]?.url) : undefined;
  const mainTitle = historyOpen
    ? 'Full history'
    : pendingRequiredActions.length > 0
      ? (hasBlockingActions ? 'Action required' : 'Follow-up actions')
      : liveAssistantText
        ? 'Response in progress'
        : isRunning
          ? 'Working'
          : latestAssistantText
            ? 'Latest response'
            : 'Ready to start a run';
  const mainSubtitle = historyOpen
    ? 'plain transcript, terminal selection and scroll'
    : pendingRequiredActions.length > 0
      ? (hasBlockingActions ? 'run blocked' : 'non-blocking')
      : liveAssistantText
        ? 'generation in progress'
        : latestAssistantText
          ? 'final summary'
          : headerSubtitle;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0} width="100%">
      <Box flexDirection="column" marginBottom={1}>
        <Text color="cyan" bold>Yagr <Text dimColor>{workspaceLabel}</Text></Text>
      </Box>

      <Panel title={mainTitle} subtitle={mainSubtitle} color={historyOpen ? 'yellow' : (pendingRequiredActions.length > 0 && hasBlockingActions) ? 'red' : pendingRequiredActions.length > 0 ? 'yellow' : 'cyan'}>
        {historyOpen ? (
          historyLines.length === 0 ? (
            <Text dimColor>No events.</Text>
          ) : historyLines.map((line) => (
            <Text key={line.id} color={line.color} dimColor={line.dimColor}>{line.text}</Text>
          ))
        ) : pendingRequiredActions.length > 0 ? (
          <RequiredActionCard actions={pendingRequiredActions} />
        ) : liveAssistantText ? (
          <Box flexDirection="column">
            <OperationList operations={visibleOperations} />
            <Text color="green">{liveAssistantText}</Text>
          </Box>
        ) : latestAssistantText ? (
          <Box flexDirection="column">
            <TerminalMarkdown text={latestAssistantText} />
            <WorkflowBanner embeds={workflowEmbeds} />
          </Box>
        ) : isRunning ? (
          <OperationList operations={visibleOperations} />
        ) : (
          <EmptyState />
        )}
      </Panel>

      <Box marginTop={1} width="100%">
        <Panel title="Prompt" subtitle={historyOpen ? 'close history to type' : 'user input'} color="cyan">
          <Box marginBottom={1} flexDirection="column">
            {isRunning ? (
              <ActiveRunIndicator phase={currentPhase} statusText={statusText} pulse={statusPulse} />
            ) : (
              <Text color={stateColor(currentState)}>{idleIcon} {statusText}</Text>
            )}
            <Text dimColor>
              {historyOpen
                ? 'History mode is active. Return with Ctrl+Y or Esc.'
                : latestWorkflowTarget
                  ? `Ctrl+Y for the full transcript. Press Ctrl+O or type /open to open the latest workflow.`
                  : 'Ctrl+Y to switch to the full transcript. Type /compact to compact context.'}
            </Text>
            {contextFillPercent !== null && (
              <Text dimColor>
                Context: {buildContextBar(contextFillPercent)} {Math.round(contextFillPercent)}%
              </Text>
            )}
            {latestWorkflowTarget ? <Text dimColor>Latest workflow: {latestWorkflowTarget}</Text> : null}
          </Box>
          <Box>
            <Text color="green">› </Text>
            <TextInput
              key={`prompt-input-${inputVersion}`}
              onSubmit={(value) => {
                void submitPrompt(value);
              }}
              placeholder={isRunning ? 'Please wait while the run is active...' : 'Describe what you want to automate'}
              isDisabled={isRunning || historyOpen}
            />
          </Box>
        </Panel>
      </Box>
    </Box>
  );
}

export async function runInteractiveGateway(handle: YagrDeepAgentHandle, options: YagrRunOptions): Promise<void> {
  await ensureLocalWorkflowOpenBridgeRunning();
  const threadIdRef = { current: randomUUID() };
  const ink = render(<YagrInteractiveApp agent={handle.agent} threadIdRef={threadIdRef} options={options} />, {
    exitOnCtrlC: false,
  });

  await ink.waitUntilExit();
}
