import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { FullScreenBox, useScreenSize, withFullScreen } from 'fullscreen-ink';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { HolonAgent } from '../agent.js';
import type { HolonPhaseEvent, HolonRunOptions, HolonToolEvent } from '../types.js';

type FeedKind = 'user' | 'assistant' | 'status' | 'error';

type FeedEntry = {
  id: number;
  kind: FeedKind;
  text: string;
};

type CommandPanelState = {
  command: string | null;
  cwd: string | null;
  lines: string[];
  running: boolean;
  exitCode: number | null;
  statusText: string | null;
  lastCommandLine: string | null;
};

const COMMAND_PANEL_COLLAPSED_LINES = 3;
const COMMAND_PANEL_EXPANDED_LINES = 10;

function phaseLabel(phase: HolonPhaseEvent['phase'] | null): string {
  switch (phase) {
    case 'inspect':
      return 'Inspection';
    case 'plan':
      return 'Preparation';
    case 'edit':
      return 'Edition';
    case 'validate':
      return 'Validation';
    case 'sync':
      return 'Synchronisation';
    case 'verify':
      return 'Verification';
    case 'summarize':
      return 'Resume';
    default:
      return 'En attente';
  }
}

function entryAccent(kind: FeedKind): string {
  switch (kind) {
    case 'user':
      return 'cyan';
    case 'assistant':
      return 'green';
    case 'status':
      return 'yellow';
    case 'error':
      return 'red';
    default:
      return 'white';
  }
}

function entryLabel(kind: FeedKind): string {
  switch (kind) {
    case 'user':
      return 'Vous';
    case 'assistant':
      return 'Holon';
    case 'status':
      return 'Activite';
    case 'error':
      return 'Erreur';
    default:
      return 'Info';
  }
}

function normalizeCommandChunk(chunk: string): string {
  return chunk.replace(/\r+/g, '\n');
}

type InteractiveAppProps = {
  agent: HolonAgent;
  options: HolonRunOptions;
};

function HolonInteractiveApp({ agent, options }: InteractiveAppProps) {
  const app = useApp();
  const { height, width } = useScreenSize();
  const [inputValue, setInputValue] = useState('');
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [showExpandedLogs, setShowExpandedLogs] = useState(false);
  const [showCommandDetails, setShowCommandDetails] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<HolonPhaseEvent['phase'] | null>(null);
  const [phaseStatusText, setPhaseStatusText] = useState('Pret.');
  const [commandPanel, setCommandPanel] = useState<CommandPanelState>({
    command: null,
    cwd: null,
    lines: [],
    running: false,
    exitCode: null,
    statusText: null,
    lastCommandLine: null,
  });
  const nextEntryIdRef = useRef(1);
  const activeAssistantEntryIdRef = useRef<number | null>(null);
  const assistantBufferRef = useRef('');
  const commandBuffersRef = useRef({ stdout: '', stderr: '' });

  const pushEntry = useCallback((kind: FeedKind, text: string) => {
    if (!text.trim()) {
      return;
    }

    setFeed((previous: FeedEntry[]) => [
      ...previous,
      {
        id: nextEntryIdRef.current++,
        kind,
        text,
      },
    ]);
  }, []);

  const ensureAssistantEntry = useCallback(() => {
    if (activeAssistantEntryIdRef.current !== null) {
      return activeAssistantEntryIdRef.current;
    }

    const id = nextEntryIdRef.current++;
    activeAssistantEntryIdRef.current = id;
    assistantBufferRef.current = '';
    setFeed((previous: FeedEntry[]) => [...previous, { id, kind: 'assistant', text: '' }]);
    return id;
  }, []);

  const updateAssistantEntry = useCallback((text: string) => {
    const id = ensureAssistantEntry();
    assistantBufferRef.current = text;
    setFeed((previous: FeedEntry[]) => previous.map((entry: FeedEntry) => (
      entry.id === id
        ? { ...entry, text }
        : entry
    )));
  }, [ensureAssistantEntry]);

  const finalizeAssistantEntry = useCallback((finalText: string) => {
    const currentText = assistantBufferRef.current.trim();
    const resolvedText = finalText.trim();

    if (!currentText && resolvedText) {
      pushEntry('assistant', resolvedText);
    } else if (resolvedText && resolvedText !== currentText) {
      updateAssistantEntry(resolvedText);
    }

    activeAssistantEntryIdRef.current = null;
    assistantBufferRef.current = '';
  }, [pushEntry, updateAssistantEntry]);

  const appendCommandLines = useCallback((rawLines: string[]) => {
    const lines = rawLines
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .map((line) => line.slice(0, 240));

    if (lines.length === 0) {
      return;
    }

    setCommandPanel((previous: CommandPanelState) => {
      const limit = showExpandedLogs ? COMMAND_PANEL_EXPANDED_LINES : COMMAND_PANEL_COLLAPSED_LINES;
      return {
        ...previous,
        lines: [...previous.lines, ...lines].slice(-limit),
      };
    });
  }, [showExpandedLogs]);

  const flushPendingCommandBuffers = useCallback(() => {
    const pending = Object.values(commandBuffersRef.current as Record<'stdout' | 'stderr', string>)
      .map((value: string) => value.trimEnd())
      .filter((value) => value.length > 0);

    commandBuffersRef.current = { stdout: '', stderr: '' };
    appendCommandLines(pending);
  }, [appendCommandLines]);

  const handleToolEvent = useCallback((event: HolonToolEvent) => {
    if (event.type === 'status' && event.toolName === 'reportProgress') {
      pushEntry('status', event.message);
      return;
    }

    if (event.type === 'command-start') {
      commandBuffersRef.current = { stdout: '', stderr: '' };
      setCommandPanel({
        command: event.command,
        cwd: event.cwd ?? null,
        lines: [],
        running: true,
        exitCode: null,
        statusText: 'Commande en cours...',
        lastCommandLine: event.command,
      });
      return;
    }

    if (event.type === 'command-output') {
      const normalized = normalizeCommandChunk(event.chunk);
      const combined = `${commandBuffersRef.current[event.stream]}${normalized}`;
      const parts = combined.split('\n');
      commandBuffersRef.current[event.stream] = parts.pop() ?? '';
      const prefixed = parts.map((line) => `${event.stream === 'stderr' ? 'err' : 'out'}  ${line}`);
      appendCommandLines(prefixed);
      return;
    }

    if (event.type === 'command-end') {
      flushPendingCommandBuffers();
      setCommandPanel((previous: CommandPanelState) => ({
        ...previous,
        running: false,
        exitCode: event.exitCode,
        statusText: event.message ?? null,
        lastCommandLine: previous.command,
      }));
    }
  }, [appendCommandLines, flushPendingCommandBuffers, pushEntry]);

  const submitPrompt = useCallback(async () => {
    const prompt = inputValue.trim();
    if (!prompt || isRunning) {
      return;
    }

    setInputValue('');

    if (prompt === '/exit' || prompt === '/quit') {
      app.exit();
      return;
    }

    if (prompt === '/clear') {
      agent.clearConversation();
      setFeed([]);
      setCurrentPhase(null);
      setPhaseStatusText('Conversation reinitialisee.');
      setCommandPanel({
        command: null,
        cwd: null,
        lines: [],
        running: false,
        exitCode: null,
        statusText: null,
        lastCommandLine: null,
      });
      return;
    }

    pushEntry('user', prompt);
    setIsRunning(true);
    setCurrentPhase('inspect');
    setPhaseStatusText('Analyse en cours...');
    activeAssistantEntryIdRef.current = null;
    assistantBufferRef.current = '';

    try {
      const result = await agent.run(prompt, {
        ...options,
        onPhaseChange: async (event) => {
          if (event.status === 'started') {
            setCurrentPhase(event.phase);
            setPhaseStatusText(event.message);
          } else if (event.phase === 'summarize') {
            setPhaseStatusText('Reponse prete.');
          }

          await options.onPhaseChange?.(event);
        },
        onTextDelta: async (textDelta) => {
          updateAssistantEntry(`${assistantBufferRef.current}${textDelta}`);
          await options.onTextDelta?.(textDelta);
        },
        onToolEvent: async (event) => {
          handleToolEvent(event);
          await options.onToolEvent?.(event);
        },
      });

      finalizeAssistantEntry(result.text);
      setCurrentPhase(null);
      setPhaseStatusText('Pret.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushEntry('error', message);
      activeAssistantEntryIdRef.current = null;
      assistantBufferRef.current = '';
      setCurrentPhase(null);
      setPhaseStatusText('Echec du run.');
    } finally {
      setIsRunning(false);
    }
  }, [agent, app, finalizeAssistantEntry, handleToolEvent, inputValue, isRunning, options, pushEntry, updateAssistantEntry]);

  useInput((inputKey, key) => {
    if (key.ctrl && inputKey === 'c') {
      app.exit();
      return;
    }

    if (key.ctrl && inputKey === 'l') {
      setShowExpandedLogs((previous: boolean) => !previous);
      return;
    }

    if (key.ctrl && inputKey === 'o') {
      setShowCommandDetails((previous: boolean) => !previous);
    }
  }, { isActive: true });

  const commandLineLimit = showExpandedLogs ? COMMAND_PANEL_EXPANDED_LINES : COMMAND_PANEL_COLLAPSED_LINES;
  const commandLines = commandPanel.lines.slice(-commandLineLimit);
  const showCommandPanel = commandPanel.running || showExpandedLogs;
  const commandPanelHeight = showCommandPanel ? (showExpandedLogs ? 12 : 6) : 0;
  const commandDetailsHeight = showCommandDetails ? 6 : 0;
  const reservedHeight = 9 + commandPanelHeight + commandDetailsHeight;
  const visibleFeedCount = Math.max(6, height - reservedHeight);
  const visibleFeed = useMemo(() => feed.slice(-visibleFeedCount), [feed, visibleFeedCount]);

  return (
    <FullScreenBox flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1} paddingY={0} marginBottom={1}>
        <Box flexDirection="column" width="100%">
          <Box>
            <Text bold color="cyan">Holon</Text>
            <Text>  </Text>
            <Text color={isRunning ? 'yellow' : 'green'}>{isRunning ? 'En cours' : 'Pret'}</Text>
            <Text>  </Text>
            <Text dimColor>Phase: {phaseLabel(currentPhase)}</Text>
          </Box>
          <Text dimColor wrap="truncate-end">{phaseStatusText}</Text>
        </Box>
      </Box>

      <Box flexGrow={1} borderStyle="round" borderColor="gray" paddingX={1} paddingY={0} marginBottom={1} flexDirection="column">
        {visibleFeed.length === 0 ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="cyan">Pose une demande en langage naturel.</Text>
            <Text dimColor>Raccourcis: Ctrl+L logs CLI, Ctrl+O details terminal, /clear, /exit.</Text>
          </Box>
        ) : (
          visibleFeed.map((entry) => (
            <Box key={entry.id} marginBottom={1} flexDirection="column">
              <Text color={entryAccent(entry.kind)} bold>{entryLabel(entry.kind)}</Text>
              <Text>{entry.text}</Text>
            </Box>
          ))
        )}
      </Box>

      {showCommandPanel ? (
        <Box height={commandPanelHeight} borderStyle="round" borderColor="magenta" paddingX={1} paddingY={0} marginBottom={1} flexDirection="column">
          <Box>
            <Text bold color="magenta">Commande CLI</Text>
            <Text>  </Text>
            <Text color={commandPanel.running ? 'yellow' : commandPanel.exitCode === 0 ? 'green' : commandPanel.exitCode === null ? 'gray' : 'red'}>
              {commandPanel.running ? 'En cours' : commandPanel.exitCode === null ? 'Inactive' : `Exit ${commandPanel.exitCode}`}
            </Text>
            <Text>  </Text>
            <Text dimColor>{showExpandedLogs ? '[Ctrl+L reduire]' : '[Ctrl+L agrandir]'}</Text>
            <Text> </Text>
            <Text dimColor>[Ctrl+O details]</Text>
          </Box>
          <Text dimColor wrap="truncate-middle">{commandPanel.command ?? 'Aucune commande en cours.'}</Text>
          <Box flexDirection="column" marginTop={1}>
            {commandLines.length === 0 ? (
              <Text dimColor>{commandPanel.statusText ?? 'Les 3 dernieres lignes apparaissent ici.'}</Text>
            ) : commandLines.map((line: string, index: number) => (
              <Text key={`${index}-${line}`} wrap="truncate">{line}</Text>
            ))}
          </Box>
        </Box>
      ) : null}

      {showCommandDetails ? (
        <Box height={commandDetailsHeight} borderStyle="round" borderColor="blue" paddingX={1} paddingY={0} marginBottom={1} flexDirection="column">
          <Box>
            <Text bold color="blue">Details terminal</Text>
            <Text>  </Text>
            <Text dimColor>[Ctrl+O fermer]</Text>
          </Box>
          <Text dimColor wrap="truncate-middle">cwd: {commandPanel.cwd ?? '.'}</Text>
          <Text wrap="truncate-middle">{commandPanel.command ?? commandPanel.lastCommandLine ?? 'Aucune commande recente.'}</Text>
          <Text dimColor wrap="truncate">Le runner actuel utilise des processus pipes, pas un terminal persistant re-ouvrable.</Text>
        </Box>
      ) : null}

      <Box borderStyle="round" borderColor="green" paddingX={1} paddingY={0} flexDirection="column">
        <Box>
          <Text bold color="green">Prompt</Text>
          <Text>  </Text>
          <Text dimColor>{isRunning ? 'Holon travaille...' : 'Entrer pour envoyer'}</Text>
        </Box>
        <Box width={Math.max(20, width - 8)}>
          <Text color="green">› </Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={() => {
              void submitPrompt();
            }}
            placeholder={isRunning ? 'Patiente pendant le run...' : 'Decris ce que tu veux automatiser'}
            focus={!isRunning}
            showCursor={!isRunning}
          />
        </Box>
      </Box>
    </FullScreenBox>
  );
}

export async function runInteractiveGateway(agent: HolonAgent, options: HolonRunOptions): Promise<void> {
  const ink = withFullScreen(<HolonInteractiveApp agent={agent} options={options} />, {
    exitOnCtrlC: false,
  });

  await ink.start();
  await ink.waitUntilExit();
}