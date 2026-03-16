import { Box, Static, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { render } from 'ink';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { HolonAgent } from '../agent.js';
import type { HolonAgentState, HolonDisplayOptions, HolonPhaseEvent, HolonRequiredAction, HolonRunOptions, HolonStateEvent, HolonToolEvent } from '../types.js';

type FeedKind = 'user' | 'assistant' | 'thinking' | 'execution' | 'error';

type FeedEntry = {
  id: number;
  kind: FeedKind;
  text: string;
};

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

function stateLabel(state: HolonAgentState): string {
  switch (state) {
    case 'idle':
      return 'Pret';
    case 'running':
      return 'En cours';
    case 'streaming':
      return 'Streaming';
    case 'waiting_for_permission':
      return 'Permission';
    case 'waiting_for_input':
      return 'Saisie';
    case 'compacting':
      return 'Compaction';
    case 'resumable':
      return 'Reprise';
    case 'completed':
      return 'Termine';
    case 'failed_terminal':
      return 'Bloque';
    default:
      return state;
  }
}

function stateColor(state: HolonAgentState): string {
  switch (state) {
    case 'idle':
      return 'green';
    case 'running':
    case 'streaming':
      return 'yellow';
    case 'completed':
      return 'greenBright';
    case 'failed_terminal':
      return 'red';
    default:
      return 'cyan';
  }
}

function entryAccent(kind: FeedKind): string {
  switch (kind) {
    case 'user':
      return 'blue';
    case 'assistant':
      return 'greenBright';
    case 'thinking':
      return 'yellow';
    case 'execution':
      return 'magentaBright';
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
      return 'Reponse';
    case 'thinking':
      return 'Reflexion';
    case 'execution':
      return 'Execution';
    case 'error':
      return 'Erreur';
    default:
      return 'Info';
  }
}

function entryMarker(kind: FeedKind): string {
  switch (kind) {
    case 'user':
      return '›';
    case 'assistant':
      return '◆';
    case 'thinking':
      return '·';
    case 'execution':
      return '$';
    case 'error':
      return '!';
    default:
      return '-';
  }
}

function normalizeDisplayOptions(display?: HolonDisplayOptions): Required<HolonDisplayOptions> {
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

function formatRequiredAction(action: HolonRequiredAction): string {
  const detail = action.detail ? ` ${action.detail}` : '';
  return `${action.title} [${action.kind}]${action.resumable ? ' resumable' : ''}: ${action.message}.${detail}`;
}

type InteractiveAppProps = {
  agent: HolonAgent;
  options: HolonRunOptions;
};

function HolonInteractiveApp({ agent, options }: InteractiveAppProps) {
  const app = useApp();
  const [inputValue, setInputValue] = useState('');
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentState, setCurrentState] = useState<HolonAgentState>('idle');
  const [currentPhase, setCurrentPhase] = useState<HolonPhaseEvent['phase'] | null>(null);
  const [phaseStatusText, setPhaseStatusText] = useState('Pret.');
  const [display, setDisplay] = useState<Required<HolonDisplayOptions>>(() => normalizeDisplayOptions(options.display));
  const [liveAssistantText, setLiveAssistantText] = useState('');
  const [liveExecutionText, setLiveExecutionText] = useState('');
  const [pendingRequiredActions, setPendingRequiredActions] = useState<HolonRequiredAction[]>([]);
  const [approvedRequiredActionIds, setApprovedRequiredActionIds] = useState<string[]>([]);
  const nextEntryIdRef = useRef(1);
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

  const finalizeAssistantEntry = useCallback((finalText: string) => {
    const currentText = liveAssistantText.trim();
    const resolvedText = finalText.trim();

    if (display.showResponses && !currentText && resolvedText) {
      pushEntry('assistant', resolvedText);
    } else if (display.showResponses && resolvedText && resolvedText !== currentText) {
      pushEntry('assistant', resolvedText);
    }

    setLiveAssistantText('');
  }, [display.showResponses, liveAssistantText, pushEntry]);

  const flushPendingCommandBuffers = useCallback(() => {
    const pending = Object.entries(commandBuffersRef.current as Record<'stdout' | 'stderr', string>)
      .map(([stream, value]: [string, string]) => ({
        stream,
        value: value.trimEnd(),
      }))
      .filter(({ value }: { value: string }) => value.length > 0)
      .map(({ stream, value }: { stream: string; value: string }) => `${stream === 'stderr' ? 'err' : 'out'}  ${value}`)
      .filter((value) => value.length > 0);

    commandBuffersRef.current = { stdout: '', stderr: '' };
    if (display.showExecution) {
      setLiveExecutionText((previous: string) => {
        const mergedLines = [previous.trimEnd(), ...pending].filter((line) => line.length > 0);
        const mergedText = mergedLines.join('\n');
        if (mergedText) {
          pushEntry('execution', mergedText);
        }
        return '';
      });
    }
  }, [display.showExecution, pushEntry]);

  const handleToolEvent = useCallback((event: HolonToolEvent) => {
    if (event.type === 'status' && event.toolName === 'reportProgress') {
      if (display.showThinking) {
        pushEntry('thinking', event.message);
      }
      return;
    }

    if (event.type === 'command-start') {
      commandBuffersRef.current = { stdout: '', stderr: '' };
      if (display.showExecution) {
        const cwd = event.cwd ? ` dans ${event.cwd}` : '';
        setLiveExecutionText(`$ ${event.command}${cwd}`);
      }
      return;
    }

    if (event.type === 'command-output') {
      const normalized = normalizeCommandChunk(event.chunk);
      const combined = `${commandBuffersRef.current[event.stream]}${normalized}`;
      const parts = combined.split('\n');
      commandBuffersRef.current[event.stream] = parts.pop() ?? '';

      if (display.showExecution) {
        const lines = parts
          .map((line) => line.trimEnd())
          .filter((line) => line.length > 0)
          .map((line) => `${event.stream === 'stderr' ? 'err' : 'out'}  ${line}`);

        if (lines.length > 0) {
          setLiveExecutionText((previous: string) => [previous, ...lines].filter((line) => line.length > 0).join('\n'));
        }
      }
      return;
    }

    if (event.type === 'command-end') {
      flushPendingCommandBuffers();
      if (display.showExecution) {
        const suffix = event.message ? ` ${event.message}` : '';
        setLiveExecutionText((previous: string) => {
          const mergedText = [previous.trimEnd(), `exit ${event.exitCode}${suffix}`].filter((line) => line.length > 0).join('\n');
          if (mergedText) {
            pushEntry('execution', mergedText);
          }
          return '';
        });
      }
      return;
    }

    if (event.type === 'result' && display.showExecution) {
      setLiveExecutionText((previous: string) => [previous, event.message].filter((line) => line.length > 0).join('\n'));
    }
  }, [display.showExecution, display.showThinking, flushPendingCommandBuffers, pushEntry]);

  const runPrompt = useCallback(async (prompt: string) => {
    if (display.showUserPrompts) {
      pushEntry('user', prompt);
    }

    setIsRunning(true);
    setCurrentState('running');
    setCurrentPhase('inspect');
    setPhaseStatusText('Analyse en cours...');
    setLiveAssistantText('');
    setLiveExecutionText('');

    try {
      const result = await agent.run(prompt, {
        ...options,
        satisfiedRequiredActionIds: approvedRequiredActionIds,
        onPhaseChange: async (event) => {
          if (event.status === 'started') {
            setCurrentPhase(event.phase);
            setPhaseStatusText(event.message);
            if (display.showThinking) {
              pushEntry('thinking', `${phaseLabel(event.phase)}: ${event.message}`);
            }
          } else if (event.phase === 'summarize') {
            setPhaseStatusText('Reponse prete.');
          }

          await options.onPhaseChange?.(event);
        },
        onStateChange: async (event: HolonStateEvent) => {
          setCurrentState(event.state);
          setPhaseStatusText(event.message);
          await options.onStateChange?.(event);
        },
        onTextDelta: async (textDelta) => {
          if (display.showResponses) {
            setLiveAssistantText((previous: string) => `${previous}${textDelta}`);
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
          pushEntry(action.kind === 'permission' ? 'thinking' : 'error', `Action requise: ${formatRequiredAction(action)}`);
        }
        setPhaseStatusText(result.requiredActions[0].message);
      } else {
        setApprovedRequiredActionIds([]);
        setPhaseStatusText('Pret.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushEntry('error', message);
      setLiveAssistantText('');
      setLiveExecutionText('');
      setCurrentState('failed_terminal');
      setCurrentPhase(null);
      setPhaseStatusText('Echec du run.');
    } finally {
      setIsRunning(false);
    }
  }, [agent, approvedRequiredActionIds, display.showResponses, display.showThinking, display.showUserPrompts, finalizeAssistantEntry, handleToolEvent, options, pushEntry]);

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
      setPendingRequiredActions([]);
      setApprovedRequiredActionIds([]);
      setCurrentState('idle');
      setCurrentPhase(null);
      setPhaseStatusText('Conversation reinitialisee.');
      setLiveAssistantText('');
      setLiveExecutionText('');
      commandBuffersRef.current = { stdout: '', stderr: '' };
      return;
    }

    if (prompt === '/toggle-thinking' || prompt === '/toggle-agent-thinking') {
      setDisplay((previous: Required<HolonDisplayOptions>) => {
        const next = { ...previous, showThinking: !previous.showThinking };
        pushEntry('thinking', `Affichage reflexion: ${next.showThinking ? 'actif' : 'masque'}.`);
        return next;
      });
      setInputValue('');
      return;
    }

    if (prompt === '/toggle-cli' || prompt === '/toggle-command-executions') {
      setDisplay((previous: Required<HolonDisplayOptions>) => {
        const next = { ...previous, showExecution: !previous.showExecution };
        pushEntry('thinking', `Affichage execution: ${next.showExecution ? 'actif' : 'masque'}.`);
        return next;
      });
      return;
    }

    if (prompt === '/pending') {
      if (pendingRequiredActions.length === 0) {
        pushEntry('thinking', 'Aucune action requise en attente.');
      } else {
        for (const action of pendingRequiredActions) {
          pushEntry('thinking', `En attente: ${formatRequiredAction(action)}`);
        }
      }
      return;
    }

    if (prompt.startsWith('/approve')) {
      const permissionActions = pendingRequiredActions.filter((action) => action.kind === 'permission');
      if (permissionActions.length === 0) {
        pushEntry('thinking', 'Aucune permission en attente.');
        return;
      }

      const approvedIds = permissionActions.map((action) => action.id);
      setApprovedRequiredActionIds((previous: string[]) => [...new Set([...previous, ...approvedIds])]);
      setPendingRequiredActions((previous: HolonRequiredAction[]) => previous.filter((action) => action.kind !== 'permission'));
      pushEntry('thinking', `Permission accordee pour ${permissionActions.length} action(s). Relance du run.`);
      await runPrompt('Permission granted. Continue the current task and execute the previously blocked step now.');
      return;
    }

    await runPrompt(prompt);
  }, [agent, app, inputValue, isRunning, pendingRequiredActions, pushEntry, runPrompt]);

  useInput((inputKey, key) => {
    if (key.ctrl && inputKey === 'c') {
      app.exit();
      return;
    }

    if (key.ctrl && inputKey === 't') {
      setDisplay((previous: Required<HolonDisplayOptions>) => ({
        ...previous,
        showThinking: !previous.showThinking,
      }));
      return;
    }

    if (key.ctrl && inputKey === 'e') {
      setDisplay((previous: Required<HolonDisplayOptions>) => ({
        ...previous,
        showExecution: !previous.showExecution,
      }));
    }
  }, { isActive: true });

  const statusLine = useMemo(() => {
    const thinking = display.showThinking ? 'reflexion on' : 'reflexion off';
    const execution = display.showExecution ? 'cli on' : 'cli off';
    return `${thinking} | ${execution} | /approve | /pending | /toggle-agent-thinking | /toggle-command-executions | /clear | /exit`;
  }, [display.showExecution, display.showThinking]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">Holon <Text color={stateColor(currentState)}>{stateLabel(currentState)}</Text> <Text dimColor>Phase: {phaseLabel(currentPhase)}</Text></Text>
        <Text dimColor wrap="truncate-end">{phaseStatusText}</Text>
        <Text dimColor>{statusLine}</Text>
      </Box>

      {feed.length === 0 ? (
        <Box marginBottom={1} flexDirection="column">
          <Box flexDirection="column" marginTop={1}>
            <Text color="cyan">Pose une demande en langage naturel.</Text>
            <Text dimColor>Les blocs defilent naturellement dans le terminal. Raccourcis: Ctrl+T, Ctrl+E, /approve, /pending, /toggle-agent-thinking, /toggle-command-executions.</Text>
          </Box>
        </Box>
      ) : null}

      {pendingRequiredActions.length > 0 ? (
        <Box marginBottom={1} flexDirection="column">
          <Text color="yellow" bold>Actions requises</Text>
          {pendingRequiredActions.map((action) => (
            <Text key={action.id} dimColor>{formatRequiredAction(action)}</Text>
          ))}
        </Box>
      ) : null}

      <Static items={feed}>
        {(entry) => (
          <Box key={entry.id} marginBottom={1} flexDirection="column">
            <Text color={entryAccent(entry.kind)} bold>{entryLabel(entry.kind)}</Text>
            {entry.kind === 'assistant' ? (
              <Text bold color="greenBright">{entry.text}</Text>
            ) : (
              <Text>{entry.text}</Text>
            )}
          </Box>
        )}
      </Static>

      {liveExecutionText ? (
        <Box marginBottom={1} flexDirection="column">
          <Text color="magentaBright" bold>Execution</Text>
          <Text>{liveExecutionText}</Text>
        </Box>
      ) : null}

      {liveAssistantText ? (
        <Box marginBottom={1} flexDirection="column">
          <Text color="greenBright" bold>Reponse</Text>
          <Text color="greenBright" bold>{liveAssistantText}</Text>
        </Box>
      ) : null}

      <Box flexDirection="column">
        <Box>
          <Text bold color="green">Prompt</Text>
          <Text>  </Text>
          <Text dimColor>{isRunning ? 'Holon travaille...' : 'Entrer pour envoyer'}</Text>
        </Box>
        <Box>
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
    </Box>
  );
}

export async function runInteractiveGateway(agent: HolonAgent, options: HolonRunOptions): Promise<void> {
  const ink = render(<HolonInteractiveApp agent={agent} options={options} />, {
    exitOnCtrlC: false,
  });

  await ink.waitUntilExit();
}