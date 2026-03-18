import { Box, Text, render, useApp, useInput } from 'ink';
import { useCallback, useState, type JSX } from 'react';

const CURSOR = '▸';
const DOT = '·';

const START_ACTION_OPTIONS = [
  { value: 'webui', label: 'Web UI', hint: 'Browser-based session' },
  { value: 'tui', label: 'Terminal UI', hint: 'Ink chat session' },
  { value: 'onboard', label: 'Onboard / reconfigure', hint: 'Run setup before launch' },
  { value: 'cancel', label: 'Cancel', hint: 'Exit without launching' },
] as const;

export type StartLaunchAction = typeof START_ACTION_OPTIONS[number]['value'];

export function resolveStartLaunchAction(answer: string): StartLaunchAction {
  const trimmed = answer.trim().toLowerCase();

  if (trimmed === '2' || trimmed === 'tui' || trimmed === 'terminal' || trimmed === 'terminal-ui') {
    return 'tui';
  }

  if (
    trimmed === '3'
    || trimmed === 'onboard'
    || trimmed === 'setup'
    || trimmed === 'reconfigure'
    || trimmed === 'configure'
  ) {
    return 'onboard';
  }

  if (trimmed === '4' || trimmed === 'cancel' || trimmed === 'exit' || trimmed === 'quit') {
    return 'cancel';
  }

  return 'webui';
}

export function promptForStartAction(): Promise<StartLaunchAction> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <StartLauncher
        onDone={(action) => {
          unmount();
          resolve(action);
        }}
      />,
    );
  });
}

function Rule(): JSX.Element {
  return <Text dimColor>{'─'.repeat(56)}</Text>;
}

function Header(): JSX.Element {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box justifyContent="space-between">
        <Text color="cyan" bold>◈  Yagr Start</Text>
        <Text dimColor>launch picker</Text>
      </Box>
      <Text color="cyan" dimColor>Runtime  {DOT}  Choose a surface or run onboarding</Text>
      <Rule />
    </Box>
  );
}

function HintBar(): JSX.Element {
  return (
    <Box marginTop={1} flexDirection="column">
      <Rule />
      <Text dimColor>↑↓  move   Enter ↵  confirm   Esc  cancel   Ctrl+C  cancel</Text>
    </Box>
  );
}

function StartLauncher({ onDone }: { onDone: (action: StartLaunchAction) => void }): JSX.Element {
  const app = useApp();
  const [cursor, setCursor] = useState(0);

  const finish = useCallback((action: StartLaunchAction) => {
    onDone(action);
    app.exit();
  }, [app, onDone]);

  useInput((input, key) => {
    if ((key.ctrl && input === 'c') || key.escape) {
      finish('cancel');
      return;
    }

    if (key.upArrow) {
      setCursor((current) => Math.max(0, current - 1));
      return;
    }

    if (key.downArrow) {
      setCursor((current) => Math.min(START_ACTION_OPTIONS.length - 1, current + 1));
      return;
    }

    if (key.return) {
      finish(START_ACTION_OPTIONS[cursor].value);
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Header />
      <Box flexDirection="column">
        <Text bold>{`${CURSOR} Launch target`}</Text>
        <Text dimColor>  Web UI is the default. Onboard re-runs setup, then returns to launch.</Text>
        <Box flexDirection="column" marginTop={1}>
          {START_ACTION_OPTIONS.map((option, index) => {
            const active = index === cursor;
            const prefix = active ? `  ${CURSOR} ` : '    ';
            return (
              <Text key={option.value} color={active ? 'cyan' : undefined} bold={active}>
                {`${prefix}${option.label}  ${DOT}  ${option.hint}`}
              </Text>
            );
          })}
        </Box>
        <HintBar />
      </Box>
    </Box>
  );
}