import { basename } from 'node:path';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type { YagrAgent } from '../agent.js';
import { getYagrN8nWorkspaceDir } from '../config/yagr-home.js';
import { ensureLocalWorkflowOpenBridgeRunning } from './local-open-bridge.js';
import { openExternalUrl } from '../system/open-external.js';
import {
  type WorkflowEmbed,
  buildWorkflowFooterTerminal,
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
  agent: YagrAgent;
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
    case 'inspect': return 'Inspection';
    case 'plan': return 'Preparation';
    case 'edit': return 'Edition';
    case 'validate': return 'Validation';
    case 'sync': return 'Synchronisation';
    case 'verify': return 'Verification';
    case 'summarize': return 'Resume';
    default: return 'En attente';
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
    case 'user': return 'Vous';
    case 'narrative': return 'Agent';
    case 'action': return 'Commande';
    case 'result': return 'Resultat';
    case 'interrupt': return 'Blocage';
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
  return `${action.title} [${action.kind}]${action.resumable ? ' resumable' : ''}: ${action.message}.${detail}`;
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
  const preserved = `${event.preservedRecentMessages} recentes`;
  const folded = `${event.messagesCompacted} repliees`;
  const source = event.source === 'llm' ? 'LLM' : 'fallback';
  return `Contexte compacte via ${source}: ${folded}, ${preserved}.`;
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
      <Text color="cyan" bold>Yagr transforme une intention en automatisation executable.</Text>
      <Text dimColor>Mode normal: une zone pour ce qui se passe, une zone pour le prompt.</Text>
      <Text dimColor>Mode historique: Ctrl+Y pour afficher le transcript complet en texte standard.</Text>
    </Box>
  );
}

function RequiredActionCard({ actions }: { actions: YagrRequiredAction[] }): JSX.Element {
  return (
    <Box flexDirection="column">
      <Text color="red" bold>Run bloque</Text>
      <Text dimColor>Yagr attend une action utilisateur pour reprendre proprement.</Text>
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
    return <Text dimColor>Yagr travaille…</Text>;
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

function WorkflowEmbedFooter({ embeds }: { embeds: WorkflowEmbed[] }): JSX.Element | null {
  if (embeds.length === 0) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>{buildWorkflowFooterTerminal(embeds)}</Text>
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
  const [phaseStatusText, setPhaseStatusText] = useState('Pret.');
  const [display, setDisplay] = useState<Required<YagrDisplayOptions>>(() => normalizeDisplayOptions(options.display));
  const [liveAssistantText, setLiveAssistantText] = useState('');
  const [latestAssistantText, setLatestAssistantText] = useState('');
  const [pendingRequiredActions, setPendingRequiredActions] = useState<YagrRequiredAction[]>([]);
  const [approvedRequiredActionIds, setApprovedRequiredActionIds] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lastUserPrompt, setLastUserPrompt] = useState('');
  const [statusPulse, setStatusPulse] = useState(0);
  const [activeOperationText, setActiveOperationText] = useState('Pret pour une demande.');
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
      pushEntry('result', 'Reponse finale', resolvedText, 'strong');
    }
  }, [display.showResponses, pushEntry]);

  const handleToolEvent = useCallback((event: YagrToolEvent) => {
    if (event.type === 'status' && event.toolName === 'reportProgress') {
      if (display.showThinking) {
        pushEntry('narrative', 'Progression', event.message);
      }
      setActiveOperationText(event.message);
      return;
    }

    if (event.type === 'command-start') {
      commandBuffersRef.current = {
        stdout: '',
        stderr: '',
        command: event.command,
        toolName: event.toolName,
      };
      setActiveOperationText(event.message ?? `Execution ${event.toolName}`);
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
        `Commande ${event.toolName}`,
        buildCommandHistoryText(command, stdoutText, stderrText, event.exitCode, event.message),
      );
      setActiveOperationText(event.message ?? `Commande ${event.toolName} terminee.`);
      commandBuffersRef.current = { stdout: '', stderr: '', command: '', toolName: '' };
      return;
    }

    if (event.type === 'result') {
      pushEntry('result', `Resultat ${event.toolName}`, event.message);
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
        pushEntry('result', 'Workflow disponible', label, 'strong');
        setActiveOperationText(`Workflow pret : ${embed.url}`);
      }
    }
  }, [display.showThinking, pushEntry]);

  const handleCompaction = useCallback(async (event: YagrContextCompactionEvent) => {
    pushEntry('result', 'Compaction', compactSummary(event));
    setActiveOperationText('Contexte compacte pour garder le run fluide.');
    await options.onCompaction?.(event);
  }, [options, pushEntry]);

  const runPrompt = useCallback(async (prompt: string) => {
    setLastUserPrompt(prompt);

    if (display.showUserPrompts) {
      pushEntry('user', 'Demande', prompt);
    }

    setIsRunning(true);
    setCurrentState('running');
    setCurrentPhase('inspect');
    setPhaseStatusText('Analyse en cours...');
    setActiveOperationText('Analyse du workspace et des contraintes.');
    setLiveAssistantText('');
    setWorkflowEmbeds([]);

    try {
      const result = await agent.run(prompt, {
        ...options,
        satisfiedRequiredActionIds: approvedRequiredActionIds,
        onCompaction: handleCompaction,
        onPhaseChange: async (event) => {
          if (event.status === 'started') {
            setCurrentPhase(event.phase);
            setPhaseStatusText(event.message);

            if (display.showThinking) {
              pushEntry('narrative', phaseLabel(event.phase), event.message);
            }
            setActiveOperationText(event.message);
          } else if (event.phase === 'summarize') {
            setPhaseStatusText('Reponse prete.');
            setActiveOperationText('Preparation de la reponse finale.');
          }

          await options.onPhaseChange?.(event);
        },
        onStateChange: async (event: YagrStateEvent) => {
          setCurrentState(event.state);
          setPhaseStatusText(event.message);

          if (event.state === 'waiting_for_permission' || event.state === 'waiting_for_input' || event.state === 'failed_terminal' || event.state === 'resumable') {
            pushEntry('interrupt', event.state === 'failed_terminal' ? 'Erreur' : 'Action requise', event.message);
          }
          setActiveOperationText(event.message);

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
          pushEntry('interrupt', 'Action requise', formatRequiredAction(action));
        }
        setPhaseStatusText(result.requiredActions[0].message);
        setActiveOperationText(result.requiredActions[0].message);
      } else {
        setApprovedRequiredActionIds([]);
        setPhaseStatusText('Pret.');
        setActiveOperationText('Run termine. Pret pour la suite.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushEntry('interrupt', 'Echec du run', message);
      setLiveAssistantText('');
      setCurrentState('failed_terminal');
      setCurrentPhase(null);
      setPhaseStatusText('Echec du run.');
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

    if (prompt === '/clear') {
      agent.clearConversation();
      setFeed([]);
      setPendingRequiredActions([]);
      setApprovedRequiredActionIds([]);
      setCurrentState('idle');
      setCurrentPhase(null);
      setPhaseStatusText('Conversation reinitialisee.');
      setLiveAssistantText('');
      setLatestAssistantText('');
      setLastUserPrompt('');
      setActiveOperationText('Pret pour une demande.');
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
        pushEntry('narrative', 'Actions requises', 'Aucune action requise en attente.');
      } else {
        for (const action of pendingRequiredActions) {
          pushEntry('interrupt', 'En attente', formatRequiredAction(action));
        }
      }
      return;
    }

    if (prompt === '/open') {
      const latestEmbed = workflowEmbeds[workflowEmbeds.length - 1];
      if (!latestEmbed) {
        pushEntry('narrative', 'Workflow', 'Aucun workflow recent a ouvrir.');
        return;
      }

      try {
        await openExternalUrl(resolveTerminalWorkflowOpenUrl(latestEmbed));
        pushEntry('result', 'Ouverture du workflow', latestEmbed.targetUrl ?? latestEmbed.url);
        setActiveOperationText(`Workflow ouvert : ${latestEmbed.targetUrl ?? latestEmbed.url}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushEntry('interrupt', 'Ouverture echouee', message);
        setActiveOperationText(`Echec ouverture workflow : ${message}`);
      }
      return;
    }

    if (prompt.startsWith('/approve')) {
      const permissionActions = pendingRequiredActions.filter((action) => action.kind === 'permission');
      if (permissionActions.length === 0) {
        pushEntry('narrative', 'Permissions', 'Aucune permission en attente.');
        return;
      }

      const approvedIds = permissionActions.map((action) => action.id);
      setApprovedRequiredActionIds((previous) => [...new Set([...previous, ...approvedIds])]);
      setPendingRequiredActions((previous) => previous.filter((action) => action.kind !== 'permission'));
      pushEntry('result', 'Permissions', `Permission accordee pour ${permissionActions.length} action(s).`);
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
          pushEntry('result', 'Ouverture du workflow', latestEmbed.targetUrl ?? latestEmbed.url);
          setActiveOperationText(`Workflow ouvert : ${latestEmbed.targetUrl ?? latestEmbed.url}`);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          pushEntry('interrupt', 'Ouverture echouee', message);
          setActiveOperationText(`Echec ouverture workflow : ${message}`);
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
      return 'Session interactive';
    }

    return truncateText(lastUserPrompt.replace(/\s+/g, ' ').trim(), Math.max(24, Math.floor(terminalWidth * 0.65)));
  }, [lastUserPrompt, terminalWidth]);

  const idleIcon = currentState === 'completed' ? '●' : currentState === 'failed_terminal' ? '✕' : '○';
  const statusText = isRunning ? activeOperationText : phaseStatusText;
  const latestWorkflowTarget = workflowEmbeds.length > 0 ? (workflowEmbeds[workflowEmbeds.length - 1]?.targetUrl ?? workflowEmbeds[workflowEmbeds.length - 1]?.url) : undefined;
  const mainTitle = historyOpen
    ? 'Historique complet'
    : pendingRequiredActions.length > 0
      ? 'Action requise'
      : liveAssistantText
        ? 'Reponse en cours'
        : latestAssistantText
          ? 'Derniere reponse'
          : 'Pret a lancer un run';
  const mainSubtitle = historyOpen
    ? 'transcript standard, selection et scroll du terminal'
    : pendingRequiredActions.length > 0
      ? 'run bloque'
      : liveAssistantText
        ? 'generation en cours'
        : latestAssistantText
          ? 'resume final'
          : headerSubtitle;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0} width="100%">
      <Box flexDirection="column" marginBottom={1}>
        <Text color="cyan" bold>Yagr <Text dimColor>{workspaceLabel}</Text></Text>
      </Box>

      <Panel title={mainTitle} subtitle={mainSubtitle} color={historyOpen ? 'yellow' : pendingRequiredActions.length > 0 ? 'red' : 'cyan'}>
        {historyOpen ? (
          historyLines.length === 0 ? (
            <Text dimColor>Aucun evenement.</Text>
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
            <WorkflowEmbedFooter embeds={workflowEmbeds} />
          </Box>
        ) : isRunning ? (
          <IntermediateMessages entries={recentIntermediateEntries} />
        ) : (
          <EmptyState />
        )}
      </Panel>

      <Box marginTop={1} width="100%">
        <Panel title="Prompt" subtitle={historyOpen ? 'ferme l’historique pour ecrire' : 'entree utilisateur'} color="cyan">
          <Box marginBottom={1} flexDirection="column">
            {isRunning ? (
              <ActiveRunIndicator phase={currentPhase} statusText={statusText} pulse={statusPulse} />
            ) : (
              <Text color={stateColor(currentState)}>{idleIcon} {statusText}</Text>
            )}
            <Text dimColor>
              {historyOpen
                ? 'Mode historique actif. Reviens avec Ctrl+Y ou Esc.'
                : latestWorkflowTarget
                  ? `Ctrl+Y pour le transcript complet. Appuie sur Ctrl+O ou tape /open pour ouvrir le dernier workflow.`
                  : 'Ctrl+Y pour basculer vers le transcript complet.'}
            </Text>
            {latestWorkflowTarget ? <Text dimColor>Dernier workflow: {latestWorkflowTarget}</Text> : null}
          </Box>
          <Box>
            <Text color="green">› </Text>
            <TextInput
              key={`prompt-input-${inputVersion}`}
              onSubmit={(value) => {
                void submitPrompt(value);
              }}
              placeholder={isRunning ? 'Patiente pendant le run...' : 'Decris ce que tu veux automatiser'}
              isDisabled={isRunning || historyOpen}
            />
          </Box>
        </Panel>
      </Box>
    </Box>
  );
}

export async function runInteractiveGateway(agent: YagrAgent, options: YagrRunOptions): Promise<void> {
  await ensureLocalWorkflowOpenBridgeRunning();
  const ink = render(<YagrInteractiveApp agent={agent} options={options} />, {
    exitOnCtrlC: false,
  });

  await ink.waitUntilExit();
}
