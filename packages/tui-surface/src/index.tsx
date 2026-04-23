import { Box, Text } from 'ink';
import type { JSX } from 'react';

export type FeedLane = 'user' | 'assistant' | 'thinking' | 'action' | 'result' | 'interrupt';
export type TuiAgentState = 'idle' | 'running' | 'streaming' | 'compacting' | 'completed' | 'waiting' | 'failed';
export type TuiEmphasis = 'normal' | 'strong';
export type TuiRequiredAction = {
  id: string;
  title: string;
  kind: string;
  message: string;
  detail?: string;
  blocking?: boolean;
  resumable?: boolean;
};
export type TuiFeedEntry = {
  id: number;
  lane: FeedLane;
  title: string;
  text: string;
  timestamp: string;
  emphasis?: TuiEmphasis;
  expanded?: boolean;
  isShellBlock?: boolean;
};

export type TuiRenderLine = {
  key: string;
  text: string;
  color?: string;
  dimColor?: boolean;
};

export function stateColor(state: TuiAgentState): string {
  switch (state) {
    case 'idle': return 'cyan';
    case 'running':
    case 'streaming':
    case 'compacting': return 'yellow';
    case 'completed': return 'green';
    case 'waiting': return 'magenta';
    case 'failed': return 'red';
  }
}

export function laneColor(lane: FeedLane): string {
  switch (lane) {
    case 'user': return 'cyan';
    case 'assistant': return 'green';
    case 'thinking': return 'magenta';
    case 'action': return 'yellow';
    case 'result': return 'green';
    case 'interrupt': return 'red';
  }
}

export function laneLabel(lane: FeedLane): string {
  switch (lane) {
    case 'user': return 'You';
    case 'assistant': return 'Assistant';
    case 'thinking': return 'Thinking';
    case 'action': return 'Action';
    case 'result': return 'Result';
    case 'interrupt': return 'Blocked';
  }
}

export function buildContextGauge(percent: number, width = 10): string {
  const filled = Math.round((percent / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function formatTimestamp(date = new Date()): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function formatRequiredAction(action: TuiRequiredAction): string {
  const detail = action.detail ? ` ${action.detail}` : '';
  const blockingLabel = action.blocking === false ? ' follow-up' : '';
  return `${action.title} [${action.kind}]${action.resumable ? ' resumable' : ''}${blockingLabel}: ${action.message}.${detail}`;
}

export function normalizeCommandChunk(chunk: string): string {
  return chunk.replace(/\r+/g, '\n');
}

export function splitStreamingText(text: string, flushAll = false): { emitted: string; remainder: string } {
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

export function entryHeader(entry: TuiFeedEntry): TuiRenderLine {
  return {
    key: `header-${entry.id}`,
    text: `[${entry.timestamp}] ${laneLabel(entry.lane)}${entry.title ? ` · ${entry.title}` : ''}`,
    color: laneColor(entry.lane),
    dimColor: true,
  };
}

export function assistantLines(entry: TuiFeedEntry): TuiRenderLine[] {
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

export function collapsedShellLines(entry: TuiFeedEntry): TuiRenderLine[] {
  const count = entry.text ? entry.text.split('\n').length : 0;
  return [
    {
      key: `shell-collapsed-${entry.id}`,
      text: `  (${count} lines · use /expand to show all)`,
      dimColor: true,
    },
  ];
}

export function expandedShellLines(entry: TuiFeedEntry): TuiRenderLine[] {
  return entry.text.split('\n').map((line, i) => ({
    key: `shell-${entry.id}-${i}`,
    text: `  ${line}`,
    color: entry.emphasis === 'strong' ? laneColor(entry.lane) : undefined,
    dimColor: entry.emphasis !== 'strong',
  }));
}

export function entryToLines(entry: TuiFeedEntry): TuiRenderLine[] {
  const lines: TuiRenderLine[] = [entryHeader(entry)];

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

export interface TuiEmptyStateProps {
  logo: string;
  title: string;
  subtitle: string;
}

export function TuiEmptyState(props: TuiEmptyStateProps): JSX.Element {
  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>{props.logo}</Text>
      <Box marginTop={1} />
      <Text color="cyan" bold>{props.title}</Text>
      <Text dimColor>{props.subtitle}</Text>
    </Box>
  );
}

export interface TuiRequiredActionListProps {
  actions: TuiRequiredAction[];
  blockingTitle?: string;
  followUpTitle?: string;
  blockingDescription?: string;
  followUpDescription?: string;
}

export function TuiRequiredActionList({
  actions,
  blockingTitle = 'Run blocked',
  followUpTitle = 'Follow-up actions',
  blockingDescription = 'Yagr is waiting for a user action before it can continue cleanly.',
  followUpDescription = 'These actions are optional but recommended.',
}: TuiRequiredActionListProps): JSX.Element {
  const hasBlocking = actions.some((action) => action.blocking !== false);
  return (
    <Box flexDirection="column" marginTop={1}>
      {hasBlocking
        ? <Text color="red" bold>{blockingTitle}</Text>
        : <Text color="yellow" bold>{followUpTitle}</Text>}
      <Text dimColor>{hasBlocking ? blockingDescription : followUpDescription}</Text>
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
