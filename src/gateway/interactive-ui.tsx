import { basename } from 'node:path';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type { YagrSessionAgent } from '../agent.js';
import { getYagrN8nWorkspaceDir } from '../config/yagr-home.js';
import { ensureLocalWorkflowOpenBridgeRunning } from './local-open-bridge.js';
import { openExternalUrl } from '../system/open-external.js';
import {
  mapPhaseEventToUserVisibleUpdate,
  mapStateEventToUserVisibleUpdate,
  mapToolEventToUserVisibleUpdate,
} from '../runtime/user-visible-updates.js';
import {
  type WorkflowEmbed,
  buildWorkflowBannerTerminal,
  extractWorkflowEmbed,
  resolveTerminalWorkflowOpenUrl,
  workflowEmbedKey,
} from './format-message.js';
import type {
  YagrAgentState,
  YagrContextCompactionEvent,
  YagrDisplayOptions,
  YagrPhaseEvent,
  YagrRequiredAction,
  YagrRunOptions,
  YagrStateEvent,
  YagrToolEvent,
} from '../types.js';

type FeedLane = 'user' | 'narrative' | 'action' | 'result' | 'interrupt';

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
  agent: YagrSessionAgent;
  options: YagrRunOptions;
};

const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];
const BAR_WIDTH = 16;
const BAR_CYCLE = (BAR_WIDTH - 1) * 2; // 30 ticks per back-and-forth
const PULSE_CYCLE = BAR_CYCLE * SPINNER_FRAMES.length; // 120 — LCM of both animations

const ACTIVITY_PHASES: Array<YagrPhaseEvent['phase']> = [
  'inspect', 'plan', 'edit', 'validate', 'sync', 'verify', 'summarize',
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
    case 'validate': return 'Validate';
    case 'sync': return 'Sync';
    case 'verify': return 'Verify';
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
    case 'narrative': return 'white';
    case 'action': return 'yellow';
    case 'result': return 'green';
    case 'interrupt': return 'red';
    default: return 'white';
  }
}

function laneLabel(lane: FeedLane): string {
  switch (lane) {
    case 'user': return 'You';
    case 'narrative': return 'Agent';
    case 'action': return 'Command';
    case 'result': return 'Result';
    case 'interrupt': return 'Blocked';
    default: return 'Log';
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

function compactSummary(event: YagrContextCompactionEvent): string {
  const preserved = `${event.preservedRecentMessages} kept recent`;
  const folded = `${event.messagesCompacted} folded`;
  const source = event.source === 'llm' ? 'LLM' : 'fallback';
  return `Context compacted via ${source}: ${folded}, ${preserved}.`;
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

function flattenFeedToHistoryLines(entries: FeedEntry[]): HistoryLine[] {
  const lines: HistoryLine[] = [];

  for (const entry of entries) {
    lines.push({
      id: `${entry.id}:header`,
      text: `[${entry.timestamp}] ${laneLabel(entry.lane)} · ${entry.title}`,
      color: laneColor(entry.lane),
    });

    const bodyLines = entry.text.split('\n');
    for (let index = 0; index < bodyLines.length; index += 1) {
      lines.push({
        id: `${entry.id}:body:${index}`,
        text: bodyLines[index].length > 0 ? `  ${bodyLines[index]}` : ' ',
        color: entry.emphasis === 'strong' ? laneColor(entry.lane) : undefined,
        dimColor: entry.lane === 'narrative',
      });
    }

    lines.push({ id: `${entry.id}:spacer`, text: ' ', dimColor: true });
  }

  return lines;
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
  return (
    <Box flexDirection="column">
      <Text color="red" bold>Run blocked</Text>
      <Text dimColor>Yagr is waiting for a user action before it can continue cleanly.</Text>
      <Box flexDirection="column" marginTop={1}>
        {actions.map((action) => (
          <Box key={action.id} flexDirection="column" marginBottom={1}>
            <Text color={action.kind === 'permission' ? 'yellow' : 'red'} bold>{action.title}</Text>
            <Text>{formatRequiredAction(action)}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function IntermediateMessages({ entries }: { entries: FeedEntry[] }): JSX.Element {
  if (entries.length === 0) {
    return <Text dimColor>Yagr is working…</Text>;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {entries.map((entry) => (
        <Box key={entry.id} flexDirection="column" marginBottom={1}>
          <Text color={laneColor(entry.lane)}>{entry.title}</Text>
          <Text dimColor={entry.lane === 'narrative'}>{truncateText(entry.text.replace(/\s+/g, ' ').trim(), 220)}</Text>
        </Box>
      ))}
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

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>{buildWorkflowBannerTerminal(embeds)}</Text>
    </Box>
  );
}

function YagrInteractiveApp({ agent, options }: InteractiveAppProps) {
  const app = useApp();
  const { stdout } = useStdout();
  const [inputVersion, setInputVersion] = useState(0);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentState, setCurrentState] = useState<YagrAgentState>('idle');
  const [currentPhase, setCurrentPhase] = useState<YagrPhaseEvent['phase'] | null>(null);
  const [phaseStatusText, setPhaseStatusText] = useState('Ready.');
  const [display, setDisplay] = useState<Required<YagrDisplayOptions>>(() => normalizeDisplayOptions(options.display));
  const [liveAssistantText, setLiveAssistantText] = useState('');
  const [latestAssistantText, setLatestAssistantText] = useState('');
  const [pendingRequiredActions, setPendingRequiredActions] = useState<YagrRequiredAction[]>([]);
  const [approvedRequiredActionIds, setApprovedRequiredActionIds] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lastUserPrompt, setLastUserPrompt] = useState('');
  const [statusPulse, setStatusPulse] = useState(0);
  const [activeOperationText, setActiveOperationText] = useState('Ready for a request.');
  const [workflowEmbeds, setWorkflowEmbeds] = useState<WorkflowEmbed[]>([]);
  const nextEntryIdRef = useRef(1);
  const commandBuffersRef = useRef({ stdout: '', stderr: '', command: '', toolName: '' });
  const workspaceLabel = useMemo(() => basename(getYagrN8nWorkspaceDir()), []);

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

  const handleToolEvent = useCallback((event: YagrToolEvent) => {
    const userFacingStatus = mapToolEventToUserVisibleUpdate(event);
    if (userFacingStatus) {
      if (display.showThinking) {
        pushEntry('narrative', userFacingStatus.title, userFacingStatus.detail ?? userFacingStatus.title);
      }
      setActiveOperationText(userFacingStatus.detail ?? userFacingStatus.title);
      return;
    }

    if (event.type === 'command-start') {
      commandBuffersRef.current = {
        stdout: '',
        stderr: '',
        command: event.command,
        toolName: event.toolName,
      };
      setActiveOperationText(event.message ?? `Running ${event.toolName}`);
      return;
    }

    if (event.type === 'command-output') {
      const normalized = normalizeCommandChunk(event.chunk);
      commandBuffersRef.current[event.stream] = `${commandBuffersRef.current[event.stream]}${normalized}`;
      return;
    }

    if (event.type === 'command-end') {
      const stdoutText = commandBuffersRef.current.stdout;
      const stderrText = commandBuffersRef.current.stderr;
      const command = commandBuffersRef.current.command || event.toolName;
      pushEntry(
        'action',
        `Command ${event.toolName}`,
        buildCommandHistoryText(command, stdoutText, stderrText, event.exitCode, event.message),
      );
      setActiveOperationText(event.message ?? `Command ${event.toolName} completed.`);
      commandBuffersRef.current = { stdout: '', stderr: '', command: '', toolName: '' };
      return;
    }

    if (event.type === 'result') {
      pushEntry('result', `Result ${event.toolName}`, event.message);
      setActiveOperationText(event.message);
      return;
    }

    if (event.type === 'embed' && event.kind === 'workflow') {
      const embed = extractWorkflowEmbed(event);
      if (embed) {
        setWorkflowEmbeds((prev) => (
          prev.some((entry) => workflowEmbedKey(entry) === workflowEmbedKey(embed))
            ? prev
            : [...prev, embed]
        ));
        const label = embed.title ? `${embed.title} — ${embed.url}` : embed.url;
        pushEntry('result', 'Workflow available', label, 'strong');
        setActiveOperationText(`Workflow ready: ${embed.url}`);
      }
    }
  }, [display.showThinking, pushEntry]);

  const handleCompaction = useCallback(async (event: YagrContextCompactionEvent) => {
    pushEntry('result', 'Compaction', compactSummary(event));
    setActiveOperationText('Context compacted to keep the run smooth.');
    await options.onCompaction?.(event);
  }, [options, pushEntry]);

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

    try {
      const result = await agent.run(prompt, {
        ...options,
        satisfiedRequiredActionIds: approvedRequiredActionIds,
        onCompaction: handleCompaction,
        onPhaseChange: async (event) => {
          const update = mapPhaseEventToUserVisibleUpdate(event);
          if (event.status === 'started') {
            setCurrentPhase(event.phase);
            setPhaseStatusText(event.message);

            if (display.showThinking && update) {
              pushEntry('narrative', update.title, update.detail ?? event.message);
            }
            setActiveOperationText(update?.detail ?? event.message);
          } else if (event.phase === 'summarize') {
            setPhaseStatusText('Response ready.');
            setActiveOperationText('Preparing the final response.');
          }

          await options.onPhaseChange?.(event);
        },
        onStateChange: async (event: YagrStateEvent) => {
          const update = mapStateEventToUserVisibleUpdate(event);
          setCurrentState(event.state);
          setPhaseStatusText(event.message);

          if (update) {
            pushEntry(
              update.tone === 'error' ? 'interrupt' : 'narrative',
              update.title,
              update.detail ?? event.message,
              update.tone === 'error' ? 'strong' : 'normal',
            );
          }
          setActiveOperationText(update?.detail ?? event.message);

          await options.onStateChange?.(event);
        },
        onTextDelta: async (textDelta) => {
          if (display.showResponses) {
            setLiveAssistantText((previous) => `${previous}${textDelta}`);
          }
          await options.onTextDelta?.(textDelta);
        },
        onToolEvent: async (event) => {
          handleToolEvent(event);
          await options.onToolEvent?.(event);
        },
      });

      finalizeAssistantEntry(result.text);
      setCurrentState(result.finalState);
      setCurrentPhase(null);
      setPendingRequiredActions(result.requiredActions);

      if (result.requiredActions.length > 0) {
        for (const action of result.requiredActions) {
          pushEntry('interrupt', 'Action required', formatRequiredAction(action));
        }
        setPhaseStatusText(result.requiredActions[0].message);
        setActiveOperationText(result.requiredActions[0].message);
      } else {
        setApprovedRequiredActionIds([]);
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
  }, [agent, approvedRequiredActionIds, display.showResponses, display.showThinking, display.showUserPrompts, finalizeAssistantEntry, handleCompaction, handleToolEvent, options, pushEntry]);

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
      agent.clearConversation();
      setFeed([]);
      setPendingRequiredActions([]);
      setApprovedRequiredActionIds([]);
      setCurrentState('idle');
      setCurrentPhase(null);
      setPhaseStatusText('Conversation reset.');
      setLiveAssistantText('');
      setLatestAssistantText('');
      setLastUserPrompt('');
      setActiveOperationText('Ready for a request.');
      setWorkflowEmbeds([]);
      commandBuffersRef.current = { stdout: '', stderr: '', command: '', toolName: '' };
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
        pushEntry('narrative', 'Required actions', 'No required actions pending.');
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
        pushEntry('narrative', 'Workflow', 'No recent workflow to open.');
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
        pushEntry('narrative', 'Permissions', 'No permissions pending.');
        return;
      }

      const approvedIds = permissionActions.map((action) => action.id);
      setApprovedRequiredActionIds((previous) => [...new Set([...previous, ...approvedIds])]);
      setPendingRequiredActions((previous) => previous.filter((action) => action.kind !== 'permission'));
      pushEntry('result', 'Permissions', `Permission granted for ${permissionActions.length} action(s).`);
      await runPrompt('Permission granted. Continue the current task and execute the previously blocked step now.');
      return;
    }

    await runPrompt(prompt);
  }, [agent, app, isRunning, pendingRequiredActions, pushEntry, runPrompt, workflowEmbeds]);

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

  const historyLines = useMemo(() => flattenFeedToHistoryLines(feed), [feed]);
  const recentIntermediateEntries = useMemo(
    () => feed.filter((entry) => entry.lane === 'narrative' || entry.lane === 'action' || entry.lane === 'interrupt').slice(-4),
    [feed],
  );
  const terminalWidth = stdout?.columns ?? process.stdout.columns ?? 100;
  const headerSubtitle = useMemo(() => {
    if (!lastUserPrompt) {
      return 'Interactive session';
    }

    return truncateText(lastUserPrompt.replace(/\s+/g, ' ').trim(), Math.max(24, Math.floor(terminalWidth * 0.65)));
  }, [lastUserPrompt, terminalWidth]);

  const idleIcon = currentState === 'completed' ? '●' : currentState === 'failed_terminal' ? '✕' : '○';
  const statusText = isRunning ? activeOperationText : phaseStatusText;
  const latestWorkflowTarget = workflowEmbeds.length > 0 ? (workflowEmbeds[workflowEmbeds.length - 1]?.targetUrl ?? workflowEmbeds[workflowEmbeds.length - 1]?.url) : undefined;
  const mainTitle = historyOpen
    ? 'Full history'
    : pendingRequiredActions.length > 0
      ? 'Action required'
      : liveAssistantText
        ? 'Response in progress'
        : latestAssistantText
          ? 'Latest response'
          : 'Ready to start a run';
  const mainSubtitle = historyOpen
    ? 'plain transcript, terminal selection and scroll'
    : pendingRequiredActions.length > 0
      ? 'run blocked'
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

      <Panel title={mainTitle} subtitle={mainSubtitle} color={historyOpen ? 'yellow' : pendingRequiredActions.length > 0 ? 'red' : 'cyan'}>
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
            <IntermediateMessages entries={recentIntermediateEntries} />
            <Text color="green">{liveAssistantText}</Text>
          </Box>
        ) : latestAssistantText ? (
          <Box flexDirection="column">
            <TerminalMarkdown text={latestAssistantText} />
            <WorkflowBanner embeds={workflowEmbeds} />
          </Box>
        ) : isRunning ? (
          <IntermediateMessages entries={recentIntermediateEntries} />
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
                  : 'Ctrl+Y to switch to the full transcript.'}
            </Text>
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

export async function runInteractiveGateway(agent: YagrSessionAgent, options: YagrRunOptions): Promise<void> {
  await ensureLocalWorkflowOpenBridgeRunning();
  const ink = render(<YagrInteractiveApp agent={agent} options={options} />, {
    exitOnCtrlC: false,
  });

  await ink.waitUntilExit();
}
