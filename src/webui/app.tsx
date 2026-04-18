import React from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useWebUiStore, isNewTabOpen, type ThreadEntry, type ChatProgressEntry, type ChatWorkflowEmbed, type ConfigSnapshot, type SessionHistoryEntry } from './store.js';
import type { SerializedChatMessage } from '../session/session-types.js';
import { parseWorkflowMap } from '../gateway/workflow-diagram.js';
import yagrLogoUrl from '../../docs/static/img/yagr-logo.png';

type ApiError = { error?: string };
type WebUiView = 'home' | 'setup';
type ThemeMode = 'system' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'yagr:webui-theme';

type ChatStreamEvent =
  | { type: 'start'; sessionId: string; message: string }
  | { type: 'phase'; phase: string; status: 'started' | 'completed'; message: string }
  | { type: 'state'; state: string; message: string }
  | { type: 'progress'; tone: 'info' | 'success' | 'error'; title: string; detail?: string; phase?: string }
  | {
      type: 'operation';
      operationId: string;
      label: string;
      category: string;
      status: 'running' | 'done' | 'error';
      body?: string;
      summary?: string;
      startedAt: number;
      endedAt?: number;
    }
  | { type: 'context-usage'; promptTokens: number; completionTokens: number; contextWindowTokens: number; fillPercent: number; source: 'api' | 'estimated' }
  | { type: 'text-delta'; delta: string }
  | { type: 'final'; sessionId: string; response: string; finalState: string; requiredActions?: Array<{ title: string; message: string }> }
  | { type: 'error'; error: string }
  | { type: 'embed'; kind: 'workflow'; workflowId: string; url: string; openUrl?: string; targetUrl?: string; title?: string; diagram?: string; executionResult?: { status: 'success' | 'error' | 'waiting'; executionId?: string; summary?: string; data?: string } };

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function request<T>(targetPath: string, init?: RequestInit): Promise<T> {
  const response = await fetch(targetPath, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error((data as ApiError | undefined)?.error ?? response.statusText);
  }

  return data as T;
}

function useNotice() {
  return React.useCallback((message: string, tone: 'info' | 'error' = 'info') => {
    const notice = document.createElement('div');
    notice.className = 'notice';
    notice.textContent = message;
    if (tone === 'error') {
      notice.style.background = 'linear-gradient(135deg, rgba(13, 16, 32, 0.96), rgba(121, 35, 73, 0.95), rgba(230, 61, 122, 0.92))';
    }
    document.body.appendChild(notice);
    window.setTimeout(() => notice.remove(), 3600);
  }, []);
}

function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case 'inspect': return 'Inspecting';
    case 'plan': return 'Planning';
    case 'edit': return 'Editing';
    case 'summarize': return 'Summarizing';
    default: return 'Working';
  }
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
}

function currentViewFromLocation(): WebUiView {
  return window.location.hash === '#setup' ? 'setup' : 'home';
}

function setViewInLocation(view: WebUiView): void {
  const nextHash = view === 'setup' ? '#setup' : '#home';
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
}

function readThemeMode(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'system' || stored === 'light' || stored === 'dark' ? stored : 'system';
}

function applyThemeMode(mode: ThemeMode): void {
  document.documentElement.dataset.themeMode = mode;
}

async function streamJsonLines(
  targetPath: string,
  init: RequestInit,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const response = await fetch(targetPath, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
      ...(init.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    const data = text ? JSON.parse(text) as ApiError : undefined;
    throw new Error(data?.error ?? response.statusText);
  }

  if (!response.body) {
    throw new Error('Streaming response body is unavailable.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf('\n');
    while (separatorIndex !== -1) {
      const line = buffer.slice(0, separatorIndex).trim();
      buffer = buffer.slice(separatorIndex + 1);

      if (line) {
        onEvent(JSON.parse(line) as ChatStreamEvent);
      }

      separatorIndex = buffer.indexOf('\n');
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    onEvent(JSON.parse(trailing) as ChatStreamEvent);
  }
}

function useWebUiView(): [WebUiView, (view: WebUiView) => void] {
  const [view, setView] = React.useState<WebUiView>(() => currentViewFromLocation());

  React.useEffect(() => {
    const onHashChange = () => {
      setView(currentViewFromLocation());
    };

    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const updateView = React.useCallback((nextView: WebUiView) => {
    setViewInLocation(nextView);
    setView(nextView);
  }, []);

  return [view, updateView];
}

function runtimeSummary(snapshot?: ConfigSnapshot): string {
  if (!snapshot) {
    return 'Loading runtime state...';
  }

  if (!snapshot.setupStatus.ready) {
    return `Missing ${snapshot.setupStatus.missingSteps.join(', ')}`;
  }

  return 'Ready';
}

function buildStreamingPreview(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.slice(-3).map((line) => line.length > 140 ? `${line.slice(0, 137).trimEnd()}...` : line);
}

function MarkdownBody({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="markdownBody">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function ThemeSelector({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}): React.JSX.Element {
  const nextThemeMode: Record<ThemeMode, ThemeMode> = {
    system: 'light',
    light: 'dark',
    dark: 'system',
  };

  const themeLabels: Record<ThemeMode, string> = {
    system: 'Use system theme',
    light: 'Use light theme',
    dark: 'Use dark theme',
  };

  const nextMode = nextThemeMode[value];
  const nextLabel = themeLabels[nextMode];

  return (
    <div className="themeControl">
      <button
        aria-label={nextLabel}
        className="themeButton"
        title={nextLabel}
        type="button"
        onClick={() => onChange(nextMode)}
      >
        <ThemeIcon mode={value} />
      </button>
    </div>
  );
}

function ThemeIcon({ mode }: { mode: ThemeMode }): React.JSX.Element {
  if (mode === 'light') {
    return (
      <svg className="themeIcon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.72 5.28l-1.77 1.77M7.05 16.95l-1.77 1.77M18.72 18.72l-1.77-1.77M7.05 7.05L5.28 5.28" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }

  if (mode === 'dark') {
    return (
      <svg className="themeIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.5 3.25a8.75 8.75 0 1 0 6.25 15.5A9.75 9.75 0 0 1 14.5 3.25Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    );
  }

  return (
    <svg className="themeIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.25a8.75 8.75 0 1 0 0 17.5Z" fill="currentColor" />
      <path d="M12 3.25a8.75 8.75 0 1 1 0 17.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function SessionSidebar({
  snapshot,
  busyLabel,
  onOpenSetup,
  themeMode,
  onThemeModeChange,
  sessionHistory,
  viewSessionId,
  runningSessionId,
  onNewSession,
  onSwitchSession,
}: {
  snapshot?: ConfigSnapshot;
  busyLabel?: string;
  onOpenSetup: () => void;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  sessionHistory: SessionHistoryEntry[];
  viewSessionId: string;
  runningSessionId: string | null;
  onNewSession: () => void;
  onSwitchSession: (id: string) => void;
}): React.JSX.Element {
  return (
    <aside className="sidebar sidebarHome">
      <section className="panel brandCard">
        <img className="brandMark" src={yagrLogoUrl} alt="Yagr logo" />
        <div className="brandCopy">
          <p className="eyebrow">Yagr Web UI</p>
          <h1 className="brandTitle">
            <span className="brandTitleLine">(Y)our</span>
            <span className="brandTitleLine">(A)gent</span>
            <span className="brandTitleLine brandTitleAccent">(G)rounded in</span>
            <span className="brandTitleLine brandTitleAccent">(R)eality.</span>
          </h1>
        </div>
        <ThemeSelector value={themeMode} onChange={onThemeModeChange} />
      </section>

      <section className="panel sessionPanel">
        <div className="sectionHeader">
          <p className="eyebrow">Session</p>
          <button
            className="gearButton"
            type="button"
            title="Open setup"
            aria-label="Open setup"
            onClick={onOpenSetup}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 0 1-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 0 1 .947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 0 1 2.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 0 1 2.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 0 1 .947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 0 1-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 0 1-2.287-.947ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="sessionFacts">
          <article className="factCard">
            <span className="infoLabel">Status</span>
            <strong>{runtimeSummary(snapshot)}</strong>
            <span className="muted">{busyLabel ?? 'Idle'}</span>
          </article>
          <article className="factCard">
            <span className="infoLabel">Model</span>
            <strong>{snapshot?.yagr.model ?? 'Not configured'}</strong>
            <span className="muted">{snapshot?.yagr.provider ?? 'No provider saved'}</span>
          </article>
          <article className="factCard">
            <span className="infoLabel">n8n project</span>
            <strong>{snapshot?.n8n.projectName ?? 'Not configured'}</strong>
            <span className="muted">{snapshot?.n8n.syncFolder ?? 'No sync folder'}</span>
          </article>
          <article className="factCard">
            <span className="infoLabel">Surfaces</span>
            <strong>{snapshot?.gatewayStatus.enabledSurfaces.length ?? 0} enabled</strong>
            <span className="muted">Telegram chats: {snapshot?.telegram.linkedChats.length ?? 0}</span>
          </article>
        </div>
      </section>

      <section className="panel historyPanel">
        <div className="sectionHeader">
          <p className="eyebrow">History</p>
          <button
            className="ghostButton newChatButton"
            type="button"
            title="Start new conversation"
            aria-label="New conversation"
            onClick={onNewSession}
          >
            +
          </button>
        </div>
        <div className="historyList">
          {sessionHistory.length === 0 && (
            <p className="muted historyEmpty">No past conversations yet.</p>
          )}
          {sessionHistory.map((session) => (
            <button
              key={session.id}
              type="button"
              className={[
                'historyItem',
                session.id === viewSessionId ? 'historyItemActive' : '',
                session.id === runningSessionId ? 'historyItemRunning' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => onSwitchSession(session.id)}
            >
              <span className="historyItemTitle">
                {session.id === runningSessionId && <span className="runningDot" role="img" aria-label="Running" />}
                {session.title}
              </span>
              <span className="historyItemMeta">
                {new Date(session.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                {' · '}{session.messageCount} msg
              </span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

function SetupPageHeader({
  onBack,
  themeMode,
  onThemeModeChange,
}: {
  onBack: () => void;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
}): React.JSX.Element {
  return (
    <div className="setupHero">
      <div className="setupHeroTopbar">
        <button className="backButton" type="button" onClick={onBack}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 3 L5 8 L10 13" />
          </svg>
          Back
        </button>
        <div className="setupHeroTopbarRight">
          <ThemeSelector value={themeMode} onChange={onThemeModeChange} />
        </div>
      </div>

    </div>
  );
}

// Node type → color palette
const NODE_COLORS: Record<string, string> = {
  manualTrigger: '#7c3aed', scheduleTrigger: '#7c3aed', webhook: '#7c3aed',
  set: '#059669', code: '#059669', functionItem: '#059669',
  httpRequest: '#2563eb', slack: '#e11d48', telegram: '#0EA5E9',
  gmail: '#ea580c', googleSheets: '#16a34a', openWeatherMap: '#0284c7',
  nasa: '#7c3aed', if: '#d97706', switch: '#d97706', merge: '#6366f1',
};

function nodeColor(type: string): string {
  return NODE_COLORS[type] ?? '#6366f1';
}

const NODE_W = 140;
const NODE_H = 52;
const COL_GAP = 60;
const ROW_GAP = 24;
const PAD = 16;

function WorkflowGraph({ diagram }: { diagram: string }): React.JSX.Element | null {
  const graph = React.useMemo(() => parseWorkflowMap(diagram), [diagram]);
  if (!graph || graph.nodes.length === 0) return <pre className="workflowDiagram">{diagram}</pre>;

  const maxCol = Math.max(...graph.nodes.map((n) => n.col));
  const maxRowPerCol = new Map<number, number>();
  for (const n of graph.nodes) {
    maxRowPerCol.set(n.col, Math.max(maxRowPerCol.get(n.col) ?? 0, n.row));
  }
  const maxRow = Math.max(...maxRowPerCol.values());
  const hasLoopEdges = graph.edges.some((e) => e.isLoop);

  const svgW = PAD * 2 + (maxCol + 1) * NODE_W + maxCol * COL_GAP;
  // add vertical room for loop arcs that draw below the bottom-most node row
  const svgH = PAD * 2 + (maxRow + 1) * NODE_H + maxRow * ROW_GAP + (hasLoopEdges ? 80 : 0);

  const pos = (n: (typeof graph.nodes)[number]) => ({
    x: PAD + n.col * (NODE_W + COL_GAP),
    y: PAD + n.row * (NODE_H + ROW_GAP),
  });

  return (
    <svg
      className="workflowGraph"
      viewBox={`0 0 ${svgW} ${svgH}`}
      width={svgW}
      height={svgH}
    >
      <defs>
        <marker id="wf-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <path d="M0,0 L8,3 L0,6" fill="var(--workflow-graph-edge)" />
        </marker>
        <marker id="wf-loop-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <path d="M0,0 L8,3 L0,6" fill="var(--workflow-graph-loop)" />
        </marker>
      </defs>
      {graph.edges.map((e, i) => {
        const src = graph.nodes.find((n) => n.id === e.from);
        const tgt = graph.nodes.find((n) => n.id === e.to);
        if (!src || !tgt) return null;
        const sp = pos(src);
        const tp = pos(tgt);
        if (e.isLoop) {
          // Back-edge: arc along the bottom of the SVG so it never cuts through other nodes
          const x1 = sp.x + NODE_W / 2;
          const y1 = sp.y + NODE_H;
          const x2 = tp.x + NODE_W / 2;
          const y2 = tp.y + NODE_H;
          // Route all loop arcs to the same baseline at the bottom of the SVG
          const cpY = svgH - 20;
          return (
            <path
              key={`e${i}`}
              d={`M${x1},${y1} C${x1},${cpY} ${x2},${cpY} ${x2},${y2}`}
              fill="none"
              stroke="var(--workflow-graph-loop)"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              markerEnd="url(#wf-loop-arrow)"
            />
          );
        }
        const x1 = sp.x + NODE_W;
        const y1 = sp.y + NODE_H / 2;
        const x2 = tp.x;
        const y2 = tp.y + NODE_H / 2;
        const cx = (x1 + x2) / 2;
        return (
          <path
            key={`e${i}`}
            d={`M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`}
            fill="none"
            stroke="var(--workflow-graph-edge)"
            strokeWidth={2}
            markerEnd="url(#wf-arrow)"
          />
        );
      })}
      {graph.nodes.map((n) => {
        const p = pos(n);
        const color = nodeColor(n.type);
        return (
          <g key={n.id}>
            <rect
              x={p.x} y={p.y}
              width={NODE_W} height={NODE_H}
              rx={10} ry={10}
              fill="var(--workflow-graph-node-bg)"
              stroke={color}
              strokeWidth={2}
            />
            <text
              x={p.x + NODE_W / 2} y={p.y + 20}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill="var(--workflow-graph-node-text)"
            >
              {n.label.length > 18 ? `${n.label.slice(0, 16)}…` : n.label}
            </text>
            <text
              x={p.x + NODE_W / 2} y={p.y + 36}
              textAnchor="middle"
              fontSize={9}
              fill="var(--workflow-graph-node-muted)"
            >
              {n.type}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function WorkflowBanner({ embed }: { embed: ChatWorkflowEmbed }): React.JSX.Element {
  const resolvedUrl = embed.openUrl ?? embed.url;

  const exec = embed.executionResult;

  return (
    <div className="workflowSimple">
      Workflow: {embed.title ?? `Workflow ${embed.workflowId}`}
      {exec ? (
        <span className={`execStatus exec${exec.status ?? ''}`}>
          {' '}{exec.status === 'success' ? '✓' : exec.status === 'error' ? '✗' : '⧗'}{exec.summary ? ` ${exec.summary}` : ''}
        </span>
      ) : null}
      {' '}<a href={resolvedUrl} target="_blank" rel="noopener noreferrer">Open in n8n</a>
    </div>
  );
}

const OPERATION_CATEGORY_ICON: Record<string, string> = {
  'file-read': '📄',
  'file-write': '✏️',
  'shell': '⚡',
  'web': '🌐',
  'tool': '🔧',
  'agent': '🤖',
  'phase': '🏁',
  'thinking': '💭',
};

function OperationRow({ entry }: { entry: ChatProgressEntry }): React.JSX.Element | null {
  const icon = OPERATION_CATEGORY_ICON[entry.category ?? 'tool'] ?? '🔧';
  const durationMs = entry.startedAt != null && entry.endedAt != null ? entry.endedAt - entry.startedAt : null;
  const duration = durationMs != null
    ? (durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`)
    : null;

  if (!entry.title && !entry.body && !entry.summary) {
    return null;
  }

  return (
    <div className="opSimple">
      <span className="opIcon" aria-hidden="true">{icon}</span>
      <span className="opLabel">{entry.title || 'Operation'}</span>
      {duration && <span className="opDuration">{duration}</span>}
      {(entry.body || entry.summary) && (
        <details className="collapsible">
          <summary className="collapsibleTrigger">Show details</summary>
          <div className="collapsibleContent">
            {entry.body && <div className="opBody">{(entry.body ?? '').trimEnd()}</div>}
            {entry.summary && !entry.body && <div className="opSummary">{entry.summary}</div>}
          </div>
        </details>
      )}
    </div>
  );
}

function UserRow({ entry }: { entry: Extract<ThreadEntry, { kind: 'user-message' }> }): React.JSX.Element {
  return (
    <div className="msgSimple msgUser">
      {entry.text}
    </div>
  );
}

function SystemRow({ entry }: { entry: Extract<ThreadEntry, { kind: 'system-notice' }> }): React.JSX.Element {
  return (
    <div className="msgSimple msgSystem">
      <MarkdownBody text={entry.text} />
    </div>
  );
}

function AssistantHeaderRow({ entry, now }: { entry: Extract<ThreadEntry, { kind: 'assistant-header' }>; now: number }): React.JSX.Element | null {
  if (!entry.streaming) return null;

  const elapsed = entry.startedAt ? formatElapsed(now - entry.startedAt) : undefined;

  return (
    <div className="msgSimple msgStreaming">
      {entry.statusLabel ?? 'Yagr is working…'}{elapsed && ` · ${elapsed}`}
    </div>
  );
}

function AssistantBodyRow({ entry }: { entry: Extract<ThreadEntry, { kind: 'assistant-body' }> }): React.JSX.Element {
  return (
    <div className={`msgSimple msgAssistant${entry.streaming ? ' msgStreaming' : ''}`}>
      {entry.text ? <MarkdownBody text={entry.text} /> : entry.streaming ? 'The answer is being composed...' : null}
      {entry.embed ? <WorkflowBanner embed={entry.embed} /> : null}
    </div>
  );
}

function HomePage({
  snapshot,
  thread,
  now,
  busyLabel,
  runActive,
  isBrowsing,
  chatInput,
  onChatInputChange,
  onSendMessage,
  onStopRun,
  onResetChat,
  onReturnToActive,
  onOpenSetup,
  chatLogRef,
  themeMode,
  onThemeModeChange,
  sessionHistory,
  viewSessionId,
  runningSessionId,
  onNewSession,
  onSwitchSession,
  contextFillPercent,
  onCompactContext,
}: {
  snapshot?: ConfigSnapshot;
  thread: ThreadEntry[];
  now: number;
  busyLabel?: string;
  runActive: boolean;
  isBrowsing: boolean;
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSendMessage: (event: React.FormEvent) => void;
  onStopRun: () => void;
  onResetChat: () => void;
  onReturnToActive: () => void;
  onOpenSetup: () => void;
  chatLogRef: React.RefObject<HTMLDivElement | null>;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  sessionHistory: SessionHistoryEntry[];
  viewSessionId: string;
  runningSessionId: string | null;
  onNewSession: () => void;
  onSwitchSession: (id: string) => void;
  contextFillPercent: number | null;
  onCompactContext: () => void;
}): React.JSX.Element {
  return (
    <div className="shell shellHome">
      <SessionSidebar
        snapshot={snapshot}
        busyLabel={busyLabel}
        onOpenSetup={onOpenSetup}
        themeMode={themeMode}
        onThemeModeChange={onThemeModeChange}
        sessionHistory={sessionHistory}
        viewSessionId={viewSessionId}
        runningSessionId={runningSessionId}
        onNewSession={onNewSession}
        onSwitchSession={onSwitchSession}
      />

      <main className="chatStage">
        <section className="panel chatPanel chatPanelSingleScroll">
          <div className="chatLog" ref={chatLogRef}>
            {thread.map((entry) => {
              switch (entry.kind) {
                case 'user-message':   return <UserRow key={entry.id} entry={entry} />;
                case 'system-notice':  return <SystemRow key={entry.id} entry={entry} />;
                case 'assistant-header': return <AssistantHeaderRow key={entry.id} entry={entry} now={now} />;
                case 'operation':      return <OperationRow key={entry.id} entry={entry.entry} />;
                case 'assistant-body': return <AssistantBodyRow key={entry.id} entry={entry} />;
                default: return null;
              }
            })}
          </div>

          {isBrowsing ? (
            <div className="composer composerDocked composerBrowsing">
              <div className="browseOverlay">
                <span className="muted">Viewing a past conversation</span>
                <button className="primaryButton" type="button" onClick={onReturnToActive}>
                  {runActive ? 'Return to active conversation' : 'Return to current session'}
                </button>
              </div>
            </div>
          ) : (
            <form className="composer composerDocked" onSubmit={(event) => void onSendMessage(event)}>
              <textarea
                value={chatInput}
                onChange={(event) => onChatInputChange(event.target.value)}
                rows={4}
                placeholder="Ask Yagr to inspect, create, validate, or evolve an automation..."
              />
              {contextFillPercent != null && (
                <div className="contextStatus">
                  <div className="contextStatusLeft">
                    <div className="contextStatusTrack">
                      <div
                        className="contextStatusFill"
                        style={{ width: `${Math.min(100, contextFillPercent)}%` }}
                        data-high={contextFillPercent >= 80 ? '' : undefined}
                        data-warn={contextFillPercent >= 60 && contextFillPercent < 80 ? '' : undefined}
                      />
                    </div>
                    <span className="contextStatusLabel">Context {Math.round(contextFillPercent)}%</span>
                    {!runActive && (
                      <button className="ghostButton compactButton" type="button" onClick={onCompactContext}>
                        Compact
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className="composerActions">
                <span className="muted">{busyLabel ?? 'Runtime idle'}</span>
                {runActive ? (
                  <button className="ghostButton dangerButton stopButton" type="button" onClick={onStopRun}>
                    <span className="stopButtonSymbol" aria-hidden="true">■</span>
                    <span>Stop</span>
                  </button>
                ) : (
                  <div className="composerButtonGroup">
                    <button className="ghostButton resetChatButton" type="button" onClick={onResetChat}>Reset chat</button>
                    <button className="primaryButton" type="submit">Send</button>
                  </div>
                )}
              </div>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}

function SetupPage({
  snapshot,
  n8nProjects,
  availableModels,
  n8nHost,
  n8nApiKey,
  n8nProjectId,
  n8nSyncFolder,
  n8nInstanceProfile,
  provider,
  llmApiKey,
  model,
  baseUrl,
  enableTelegram,
  telegramBotToken,
  onN8nHostChange,
  onN8nApiKeyChange,
  onN8nProjectIdChange,
  onN8nSyncFolderChange,
  onN8nInstanceProfileChange,
  onProviderChange,
  onLlmApiKeyChange,
  onModelChange,
  onBaseUrlChange,
  onEnableTelegramChange,
  onTelegramBotTokenChange,
  onLoadProjects,
  onSaveN8n,
  onLoadModels,
  onSaveLlm,
  onSaveSurfaces,
  onConfigureTelegram,
  onResetTelegram,
  onBack,
  onRefresh,
  themeMode,
  onThemeModeChange,
}: {
  snapshot?: ConfigSnapshot;
  n8nProjects: Array<{ id: string; name: string }>;
  availableModels: string[];
  n8nHost: string;
  n8nApiKey: string;
  n8nProjectId: string;
  n8nSyncFolder: string;
  n8nInstanceProfile: 'custom-cloud' | 'custom-local-docker' | 'custom-local-direct';
  provider: string;
  llmApiKey: string;
  model: string;
  baseUrl: string;
  enableTelegram: boolean;
  telegramBotToken: string;
  onN8nHostChange: (value: string) => void;
  onN8nApiKeyChange: (value: string) => void;
  onN8nProjectIdChange: (value: string) => void;
  onN8nSyncFolderChange: (value: string) => void;
  onN8nInstanceProfileChange: (value: 'custom-cloud' | 'custom-local-docker' | 'custom-local-direct') => void;
  onProviderChange: (value: string) => void;
  onLlmApiKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onEnableTelegramChange: (value: boolean) => void;
  onTelegramBotTokenChange: (value: string) => void;
  onLoadProjects: () => void;
  onSaveN8n: () => void;
  onLoadModels: () => void;
  onSaveLlm: () => void;
  onSaveSurfaces: () => void;
  onConfigureTelegram: () => void;
  onResetTelegram: () => void;
  onBack: () => void;
  onRefresh: () => void;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
}): React.JSX.Element {
  const telegramLink = snapshot?.telegram.deepLink;

  const modelRef = React.useRef(model);
  React.useEffect(() => { modelRef.current = model; }, [model]);
  const [modelDisplay, setModelDisplay] = React.useState(model);
  React.useEffect(() => { setModelDisplay(model); }, [model]);

  return (
    <div className="shell shellSetup">
      <main className="setupStage">
        <SetupPageHeader
          onBack={onBack}
          themeMode={themeMode}
          onThemeModeChange={onThemeModeChange}
        />

        <div className="setupScroll">
          <div className="setupGrid">
            <section className="panel formPanel">
              <div className="sectionHeader">
                <p className="eyebrow">Current orchestrator</p>
                <button className="ghostButton" type="button" onClick={onLoadProjects}>Load projects</button>
              </div>
              <label>
                <span>Instance URL</span>
                <input value={n8nHost} onChange={(event) => onN8nHostChange(event.target.value)} type="url" placeholder="https://your-n8n.example.com" />
              </label>
              <label>
                <span>API key</span>
                <input value={n8nApiKey} onChange={(event) => onN8nApiKeyChange(event.target.value)} type="password" placeholder="Leave empty to reuse saved key" />
              </label>
              <label>
                <span>Instance type</span>
                <select value={n8nInstanceProfile} onChange={(event) => onN8nInstanceProfileChange(event.target.value as 'custom-cloud' | 'custom-local-docker' | 'custom-local-direct')}>
                  <option value="custom-cloud">Cloud instance</option>
                  <option value="custom-local-docker">Local instance running in Docker</option>
                  <option value="custom-local-direct">Local instance not running in Docker</option>
                </select>
              </label>
              <label>
                <span>Project</span>
                <select value={n8nProjectId} onChange={(event) => onN8nProjectIdChange(event.target.value)}>
                  <option value="">Load projects first</option>
                  {n8nProjects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Local sync folder</span>
                <input value={n8nSyncFolder} onChange={(event) => onN8nSyncFolderChange(event.target.value)} type="text" placeholder="workflows" />
              </label>
              <button className="primaryButton" type="button" onClick={onSaveN8n}>Save orchestrator</button>
              <p className="hint">This writes the current n8n connection and explicit instance type used by onboarding and by the runtime.</p>
            </section>

            <section className="panel formPanel">
              <div className="sectionHeader">
                <p className="eyebrow">LLM</p>
                <button className="ghostButton" type="button" onClick={onLoadModels}>Load models</button>
              </div>
              <label>
                <span>Provider</span>
                <select value={provider} onChange={(event) => onProviderChange(event.target.value)}>
                  {(snapshot?.yagr.providers ?? []).map((entry) => (
                    <option key={entry.provider} value={entry.provider}>{entry.provider}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>API key</span>
                <input value={llmApiKey} onChange={(event) => onLlmApiKeyChange(event.target.value)} type="password" placeholder="Leave empty to reuse saved key" />
              </label>
              <label>
                <span>Model</span>
                <input
                  value={modelDisplay}
                  type="text"
                  list="llm-model-list"
                  placeholder={model ? model : 'Load models or type an ID…'}
                  onFocus={() => setModelDisplay('')}
                  onChange={(e) => { setModelDisplay(e.target.value); onModelChange(e.target.value); }}
                  onBlur={() => {
                    window.setTimeout(() => {
                      setModelDisplay((current) => current || modelRef.current);
                    }, 100);
                  }}
                />
                <datalist id="llm-model-list">
                  {availableModels.map((entry) => <option key={entry} value={entry} />)}
                </datalist>
              </label>
              <label>
                <span>Base URL</span>
                <input value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} type="url" placeholder="Optional custom base URL" />
              </label>
              <button className="primaryButton" type="button" onClick={onSaveLlm}>Save model config</button>
            </section>

            <section className="panel formPanel">
              <p className="eyebrow">Optional integrations</p>
              <label className="checkboxRow">
                <input checked={enableTelegram} onChange={(event) => onEnableTelegramChange(event.target.checked)} type="checkbox" />
                <span>Telegram</span>
              </label>
              <button className="primaryButton" type="button" onClick={onSaveSurfaces}>Save surfaces</button>
              <p className="hint">The Web UI and TUI are always available. This section only controls extra messaging integrations.</p>
            </section>

            <section className="panel formPanel">
              <div className="sectionHeader">
                <p className="eyebrow">Telegram</p>
                <button className="ghostButton dangerButton" type="button" onClick={onResetTelegram}>Reset</button>
              </div>
              <label>
                <span>Bot token</span>
                <input value={telegramBotToken} onChange={(event) => onTelegramBotTokenChange(event.target.value)} type="password" placeholder="123456:ABC..." />
              </label>
              <button className="primaryButton" type="button" onClick={onConfigureTelegram}>Configure Telegram</button>
              <div className="infoList">
                <div>
                  <span className="infoLabel">Bot</span>
                  <strong>{snapshot?.telegram.botUsername ?? 'Not configured'}</strong>
                </div>
                <div>
                  <span className="infoLabel">Linked chats</span>
                  <strong>{snapshot?.telegram.linkedChats.length ?? 0}</strong>
                </div>
                <div>
                  <span className="infoLabel">Onboarding</span>
                  {telegramLink ? <a className="linkButton" href={telegramLink} target="_blank" rel="noreferrer">Open onboarding link</a> : <span className="muted">Unavailable</span>}
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

function restoreSessionThread(session: {
  messages: Array<{ role: string; content: unknown }>;
  displayThread?: ThreadEntry[];
  displayMessages?: SerializedChatMessage[];
}): ThreadEntry[] {
  if (session.displayThread) {
    return session.displayThread;
  }

  if (session.displayMessages && session.displayMessages.length > 0) {
    return session.displayMessages.flatMap((msg) => {
      if (msg.role === 'user') return [{ kind: 'user-message' as const, id: msg.id ?? crypto.randomUUID(), text: msg.text }];
      if (msg.role === 'system') return [{ kind: 'system-notice' as const, id: msg.id ?? crypto.randomUUID(), text: msg.text }];

      const res: ThreadEntry[] = [];
      for (const op of msg.progress ?? []) {
        res.push({ kind: 'operation', id: op.id, entry: op });
      }
      res.push({ kind: 'assistant-body', id: `${msg.id}:body`, text: msg.text ?? '', streaming: false, finalState: msg.finalState, embed: msg.embed });
      return res;
    });
  }

  const result = session.messages.flatMap((m) => {
    if (m.role !== 'user' && m.role !== 'assistant') {
      return [];
    }

    const text =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? (m.content as Array<{ type: string; text?: string }>)
              .filter((p) => p.type === 'text')
              .map((p) => p.text ?? '')
              .join('')
          : '';

    if (!text) {
      return [];
    }

    if (m.role === 'user') {
      return [{ kind: 'user-message', id: crypto.randomUUID(), text }];
    }
    return [{ kind: 'assistant-body', id: crypto.randomUUID(), text, streaming: false }];
  });

  return result.length > 0
    ? result
    : [{ kind: 'system-notice', id: crypto.randomUUID(), text: 'Session loaded. Continue the conversation.' }];
}

function App() {
  const {
    sessionId,
    snapshot,
    n8nProjects,
    availableModels,
    thread,
    busyLabel,
    setBusyLabel,
    setError,
    setSnapshot,
    setProjects,
    setAvailableModels,
    pushEntry,
    patchEntry,
    appendBodyText,
    upsertOperation,
    resetThread,
    sessionHistory,
    setSessionHistory,
    setThread,
    switchSession,
    viewSessionId,
    viewThread,
    browseSession,
    setViewThread,
    returnToActiveSession,
  } = useWebUiStore();

  const notify = useNotice();
  const [view, setView] = useWebUiView();
  const [themeMode, setThemeMode] = React.useState<ThemeMode>(() => readThemeMode());
  const chatLogRef = React.useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = React.useRef(true);
  const activeStreamRef = React.useRef<AbortController | null>(null);

  const [n8nHost, setN8nHost] = React.useState('');
  const [n8nApiKey, setN8nApiKey] = React.useState('');
  const [n8nProjectId, setN8nProjectId] = React.useState('');
  const [n8nSyncFolder, setN8nSyncFolder] = React.useState('workflows');
  const [n8nInstanceProfile, setN8nInstanceProfile] = React.useState<'custom-cloud' | 'custom-local-docker' | 'custom-local-direct'>('custom-cloud');

  const [provider, setProvider] = React.useState('openrouter');
  const [llmApiKey, setLlmApiKey] = React.useState('');
  const [model, setModel] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState('');

  const [enableTelegram, setEnableTelegram] = React.useState(false);
  const [telegramBotToken, setTelegramBotToken] = React.useState('');

  const [chatInput, setChatInput] = React.useState('');
  const [now, setNow] = React.useState(() => Date.now());
  const [contextFillPercent, setContextFillPercent] = React.useState<number | null>(null);
  const runActive = React.useMemo(() => thread.some((entry) => entry.kind === 'assistant-header' && entry.streaming), [thread]);
  const isBrowsing = viewSessionId !== sessionId;
  const displayThread = viewThread ?? thread;

  React.useEffect(() => {
    applyThemeMode(themeMode);
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  React.useEffect(() => {
    if (!thread.some((entry) => entry.kind === 'assistant-header' && entry.streaming)) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [thread]);

  React.useEffect(() => {
    const chatLog = chatLogRef.current;
    if (!chatLog) {
      return undefined;
    }

    const handleScroll = () => {
      const distanceFromBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight;
      stickToBottomRef.current = distanceFromBottom < 72;
    };

    handleScroll();
    chatLog.addEventListener('scroll', handleScroll);
    return () => chatLog.removeEventListener('scroll', handleScroll);
  }, [view]);

  React.useLayoutEffect(() => {
    const chatLog = chatLogRef.current;
    if (!chatLog || !stickToBottomRef.current) {
      return;
    }

    chatLog.scrollTop = chatLog.scrollHeight;
  }, [thread]);

  const hydrate = React.useCallback((nextSnapshot: ConfigSnapshot) => {
    setSnapshot(nextSnapshot);
    setN8nHost(nextSnapshot.n8n.host ?? '');
    setN8nApiKey('');
    setN8nProjectId(nextSnapshot.n8n.projectId ?? '');
    setN8nSyncFolder(nextSnapshot.n8n.syncFolder ?? 'workflows');
    setN8nInstanceProfile((nextSnapshot.n8n.instanceProfile as 'custom-cloud' | 'custom-local-docker' | 'custom-local-direct' | undefined) ?? 'custom-cloud');
    setProvider(nextSnapshot.yagr.provider ?? 'openrouter');
    setLlmApiKey('');
    setModel(nextSnapshot.yagr.model ?? '');
    setBaseUrl(nextSnapshot.yagr.baseUrl ?? '');
    setEnableTelegram(nextSnapshot.gatewayStatus.enabledSurfaces.includes('telegram'));
    setTelegramBotToken('');
  }, [setSnapshot]);

  const refreshConfig = React.useCallback(async () => {
    setBusyLabel('Refreshing state...');
    try {
      const nextSnapshot = await request<ConfigSnapshot>('/api/config');
      hydrate(nextSnapshot);
      setError(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      notify(message, 'error');
    } finally {
      setBusyLabel(undefined);
    }
  }, [hydrate, notify, setBusyLabel, setError]);

  React.useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  // --------------------------------------------------------------------------
  // Session management
  // --------------------------------------------------------------------------

  // Pure server fetch — no client-side invariants. The server is always right.
  const refreshSessions = React.useCallback(async () => {
    try {
      const result = await request<{ sessions: SessionHistoryEntry[] }>('/api/sessions');
      setSessionHistory(result.sessions);
    } catch {
      // Non-critical.
    }
  }, [setSessionHistory]); // setSessionHistory is stable — this callback is created once.

  // On mount: register the current session with the server and load data.
  // The session ID is already fresh (new tab) or restored (F5) — set
  // synchronously in store.ts before React renders. No race condition.
  React.useEffect(() => {
    void (async () => {
      try {
        // Ensure the session file exists on disk (creates if missing, idempotent).
        await request('/api/sessions', { method: 'POST', body: JSON.stringify({ id: sessionId }) });

        // On F5: restore messages from the server so the user sees their history.
        if (!isNewTabOpen) {
          try {
            const session = await request<{
              messages: Array<{ role: string; content: unknown }>;
              displayThread?: ThreadEntry[];
              displayMessages?: SerializedChatMessage[];
            }>(`/api/sessions/${sessionId}`);
            const restored = restoreSessionThread(session);
            if (restored.length > 0) {
              const isOnlySystemNotice = restored.length === 1 && restored[0].kind === 'system-notice';
              if (!isOnlySystemNotice) {
                setThread(restored);
              }
            }
          } catch {
            // Session file missing or empty — keep the default welcome message.
          }
        }
      } catch {
        // Registration failed — the user can still chat; persistSession will
        // create the file after the first run completes.
      }

    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only

  // Load the session list once on mount (and whenever refreshSessions identity
  // changes, which never happens since its deps are stable).
  React.useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const onNewSession = React.useCallback(() => {
    if (activeStreamRef.current) {
      return;
    }

    void (async () => {
      try {
        // Server creates the session file immediately → it appears in the list right away.
        const { id } = await request<{ id: string }>('/api/sessions', { method: 'POST' });
        switchSession(id);
        setThread([{ kind: 'system-notice', id: crypto.randomUUID(), text: 'New conversation. How can Yagr help?' }]);
        void refreshSessions();
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), 'error');
      }
    })();
  }, [switchSession, setThread, refreshSessions, notify]);

  const onSwitchSession = React.useCallback((targetId: string) => {
    // If the target is already the active session, just return to it
    // (clear any browse overlay).
    if (targetId === sessionId) {
      returnToActiveSession();
      return;
    }

    // If a stream is running, browse read-only instead of hard-switching.
    if (activeStreamRef.current) {
      browseSession(targetId);

      void (async () => {
        try {
          const session = await request<{
            messages: Array<{ role: string; content: unknown }>;
            displayThread?: ThreadEntry[];
            displayMessages?: SerializedChatMessage[];
          }>(`/api/sessions/${targetId}`);
          setViewThread(restoreSessionThread(session));
        } catch {
          setViewThread([{ kind: 'system-notice', id: crypto.randomUUID(), text: 'Could not restore session.' }]);
        }
      })();
      return;
    }

    // No active stream — hard-switch as before.
    switchSession(targetId);

    void (async () => {
      try {
        const session = await request<{
          messages: Array<{ role: string; content: unknown }>;
          displayThread?: ThreadEntry[];
          displayMessages?: SerializedChatMessage[];
        }>(`/api/sessions/${targetId}`);
        setThread(restoreSessionThread(session));
      } catch {
        setThread([{ kind: 'system-notice', id: crypto.randomUUID(), text: 'Could not restore session.' }]);
      } finally {
        void refreshSessions();
      }
    })();
  }, [sessionId, switchSession, setThread, refreshSessions, browseSession, setViewThread, returnToActiveSession]);

  const onLoadProjects = async () => {
    try {
      const result = await request<{ projects: Array<{ id: string; name: string }>; selectedProjectId?: string }>('/api/n8n/projects', {
        method: 'POST',
        body: JSON.stringify({ host: n8nHost, apiKey: n8nApiKey || undefined }),
      });
      setProjects(result.projects);
      if (result.selectedProjectId) {
        setN8nProjectId(result.selectedProjectId);
      }
      notify('n8n projects loaded.');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusyLabel(undefined);
    }
  };

  const onSaveN8n = async () => {
    setBusyLabel('Saving orchestrator connection...');
    try {
      const result = await request<{ warning?: string; snapshot: ConfigSnapshot }>('/api/config/n8n', {
        method: 'POST',
        body: JSON.stringify({ host: n8nHost, apiKey: n8nApiKey || undefined, projectId: n8nProjectId, syncFolder: n8nSyncFolder, instanceProfile: n8nInstanceProfile }),
      });
      hydrate(result.snapshot);
      notify(result.warning ?? 'Orchestrator connection saved.');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusyLabel(undefined);
    }
  };

  const onLoadModels = async () => {
    setBusyLabel('Loading models...');
    try {
      const result = await request<{ models: string[] }>('/api/llm/models', {
        method: 'POST',
        body: JSON.stringify({ provider, apiKey: llmApiKey || undefined }),
      });
      setAvailableModels(result.models);
      notify(result.models.length ? 'Models loaded.' : 'No models returned.');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusyLabel(undefined);
    }
  };

  const onSaveLlm = async () => {
    setBusyLabel('Saving model config...');
    try {
      const result = await request<{ snapshot: ConfigSnapshot }>('/api/config/llm', {
        method: 'POST',
        body: JSON.stringify({ provider, apiKey: llmApiKey || undefined, model, baseUrl: baseUrl || undefined }),
      });
      hydrate(result.snapshot);
      notify('LLM configuration saved.');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusyLabel(undefined);
    }
  };

  const onSaveSurfaces = async () => {
    setBusyLabel('Saving surfaces...');
    try {
      const enabledSurfaces = [enableTelegram ? 'telegram' : null].filter(Boolean);
      const result = await request<{ snapshot: ConfigSnapshot }>('/api/config/surfaces', {
        method: 'POST',
        body: JSON.stringify({ enabledSurfaces }),
      });
      hydrate(result.snapshot);
      notify('Gateway surfaces saved.');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusyLabel(undefined);
    }
  };

  const onConfigureTelegram = async () => {
    setBusyLabel('Configuring Telegram...');
    try {
      const result = await request<{ snapshot: ConfigSnapshot }>('/api/telegram/configure', {
        method: 'POST',
        body: JSON.stringify({ botToken: telegramBotToken }),
      });
      hydrate(result.snapshot);
      notify('Telegram configured.');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusyLabel(undefined);
    }
  };

  const onResetTelegram = async () => {
    setBusyLabel('Resetting Telegram...');
    try {
      const result = await request<{ snapshot: ConfigSnapshot }>('/api/telegram/reset', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      hydrate(result.snapshot);
      notify('Telegram reset.');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusyLabel(undefined);
    }
  };

  const onResetChat = async () => {
    setBusyLabel('Resetting conversation...');
    try {
      await request('/api/chat/reset', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      resetThread();
      setContextFillPercent(null);
      notify('Conversation reset.');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusyLabel(undefined);
    }
  };

  const onSendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (activeStreamRef.current || isBrowsing) {
      return;
    }

    const trimmed = chatInput.trim();
    if (!trimmed) {
      return;
    }

    const userMessageId = crypto.randomUUID();
    const headerId = crypto.randomUUID();
    const bodyId = crypto.randomUUID();

    pushEntry({ kind: 'user-message', id: userMessageId, text: trimmed });
    pushEntry({
      kind: 'assistant-header',
      id: headerId,
      streaming: true,
      phase: 'inspect',
      statusLabel: 'Starting run...',
      startedAt: Date.now(),
    });
    pushEntry({
      kind: 'assistant-body',
      id: bodyId,
      streaming: true,
      text: '',
    });

    setChatInput('');
    setBusyLabel('Yagr is working...');
    stickToBottomRef.current = true;
    const abortController = new AbortController();
    activeStreamRef.current = abortController;

    try {
      await streamJsonLines('/api/chat/stream', {
        method: 'POST',
        signal: abortController.signal,
        body: JSON.stringify({ sessionId, message: trimmed }),
      }, (streamEvent) => {
        if (streamEvent.type === 'start') {
          patchEntry(headerId, { phase: 'inspect', statusLabel: streamEvent.message });
          setBusyLabel(streamEvent.message);
          return;
        }

        if (streamEvent.type === 'phase') {
          if (streamEvent.status === 'started') {
            patchEntry(headerId, {
              phase: streamEvent.phase,
              statusLabel: streamEvent.message,
            });
            setBusyLabel(streamEvent.message);
          }
          return;
        }

        if (streamEvent.type === 'state') {
          patchEntry(headerId, { statusLabel: streamEvent.message });
          setBusyLabel(streamEvent.message);
          return;
        }

        if (streamEvent.type === 'progress') {
          upsertOperation(crypto.randomUUID(), {
            id: crypto.randomUUID(),
            tone: streamEvent.tone,
            title: streamEvent.title,
            detail: streamEvent.detail,
          });
          patchEntry(headerId, { statusLabel: streamEvent.detail ?? streamEvent.title });
          setBusyLabel(streamEvent.detail ?? streamEvent.title);
          return;
        }

        if (streamEvent.type === 'operation') {
          upsertOperation(streamEvent.operationId, {
            id: streamEvent.operationId,
            tone: streamEvent.status === 'error' ? 'error' : 'info',
            title: streamEvent.label,
            category: streamEvent.category,
            status: streamEvent.status,
            body: streamEvent.body,
            summary: streamEvent.summary,
            startedAt: streamEvent.startedAt,
            endedAt: streamEvent.endedAt,
          });
          return;
        }

        if (streamEvent.type === 'context-usage') {
          setContextFillPercent(streamEvent.fillPercent);
          return;
        }

        if (streamEvent.type === 'embed') {
          patchEntry(bodyId, {
            embed: {
              kind: streamEvent.kind,
              workflowId: streamEvent.workflowId,
              url: streamEvent.url,
              openUrl: streamEvent.openUrl,
              targetUrl: streamEvent.targetUrl,
              title: streamEvent.title,
              diagram: streamEvent.diagram,
              executionResult: streamEvent.executionResult,
            },
          });
          return;
        }

        if (streamEvent.type === 'text-delta') {
          appendBodyText(bodyId, streamEvent.delta);
          return;
        }

        if (streamEvent.type === 'final') {
          patchEntry(headerId, { streaming: false });
          patchEntry(bodyId, {
            text: streamEvent.response,
            streaming: false,
            finalState: streamEvent.finalState,
          });
          setBusyLabel(undefined);
          if (streamEvent.requiredActions?.length) {
            notify('Yagr returned required actions. Review the response details.', 'error');
          }
          return;
        }

        patchEntry(headerId, { streaming: false });
        patchEntry(bodyId, {
          text: streamEvent.error,
          streaming: false,
          finalState: 'failed_terminal',
        });
        setBusyLabel(undefined);
        notify(streamEvent.error, 'error');
      });
    } catch (error) {
      if (isAbortError(error)) {
        patchEntry(headerId, { streaming: false });
        patchEntry(bodyId, {
          text: 'Run stopped.',
          streaming: false,
          finalState: 'stopped',
        });
      } else {
        patchEntry(headerId, { streaming: false });
        patchEntry(bodyId, {
          text: error instanceof Error ? error.message : String(error),
          streaming: false,
          finalState: 'failed_terminal',
        });
        notify(error instanceof Error ? error.message : String(error), 'error');
      }
    } finally {
      activeStreamRef.current = null;
      setBusyLabel(undefined);
      void (async () => {
        try {
          const currentThread = useWebUiStore.getState().thread
            .filter((e) => e.kind !== 'assistant-header' || !e.streaming)
            .filter((e) => e.kind !== 'assistant-body' || !e.streaming);
          await request(`/api/sessions/${sessionId}`, {
            method: 'PATCH',
            body: JSON.stringify({ displayThread: currentThread }),
          });
        } catch {
          // Non-critical.
        } finally {
          void refreshSessions();
        }
      })();
    }
  };

  const onStopRun = React.useCallback(() => {
    if (!activeStreamRef.current) {
      return;
    }

    setBusyLabel('Stopping run...');
    activeStreamRef.current.abort();
  }, [setBusyLabel]);

  const onCompactContext = async () => {
    if (runActive) {
      return;
    }

    setBusyLabel('Compacting context…');
    try {
      const result = await request<{ compacted: boolean; event: { messagesCompacted: number; preservedRecentMessages: number } | null }>(
        '/api/chat/compact',
        { method: 'POST', body: JSON.stringify({ sessionId }) },
      );
      if (result.compacted && result.event) {
        setContextFillPercent(null);
        notify(`Context compacted: ${result.event.messagesCompacted} messages folded.`);
      } else {
        notify('Nothing to compact — conversation is too short.');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusyLabel(undefined);
    }
  };

  if (view === 'setup') {
    return (
      <SetupPage
        snapshot={snapshot}
        n8nProjects={n8nProjects}
        availableModels={availableModels}
        n8nHost={n8nHost}
        n8nApiKey={n8nApiKey}
        n8nProjectId={n8nProjectId}
        n8nSyncFolder={n8nSyncFolder}
        n8nInstanceProfile={n8nInstanceProfile}
        provider={provider}
        llmApiKey={llmApiKey}
        model={model}
        baseUrl={baseUrl}
        enableTelegram={enableTelegram}
        telegramBotToken={telegramBotToken}
        onN8nHostChange={setN8nHost}
        onN8nApiKeyChange={setN8nApiKey}
        onN8nProjectIdChange={setN8nProjectId}
        onN8nSyncFolderChange={setN8nSyncFolder}
        onN8nInstanceProfileChange={setN8nInstanceProfile}
        onProviderChange={setProvider}
        onLlmApiKeyChange={setLlmApiKey}
        onModelChange={setModel}
        onBaseUrlChange={setBaseUrl}
        onEnableTelegramChange={setEnableTelegram}
        onTelegramBotTokenChange={setTelegramBotToken}
        onLoadProjects={() => void onLoadProjects()}
        onSaveN8n={() => void onSaveN8n()}
        onLoadModels={() => void onLoadModels()}
        onSaveLlm={() => void onSaveLlm()}
        onSaveSurfaces={() => void onSaveSurfaces()}
        onConfigureTelegram={() => void onConfigureTelegram()}
        onResetTelegram={() => void onResetTelegram()}
        onBack={() => setView('home')}
        onRefresh={() => void refreshConfig()}
        themeMode={themeMode}
        onThemeModeChange={setThemeMode}
      />
    );
  }

  return (
    <HomePage
      snapshot={snapshot}
      thread={displayThread}
      now={now}
      busyLabel={busyLabel}
      runActive={runActive}
      isBrowsing={isBrowsing}
      chatInput={chatInput}
      onChatInputChange={setChatInput}
      onSendMessage={onSendMessage}
      onStopRun={onStopRun}
      onResetChat={() => void onResetChat()}
      onReturnToActive={returnToActiveSession}
      onOpenSetup={() => setView('setup')}
      chatLogRef={chatLogRef}
      themeMode={themeMode}
      onThemeModeChange={setThemeMode}
      sessionHistory={sessionHistory}
      viewSessionId={viewSessionId}
      runningSessionId={runActive ? sessionId : null}
      onNewSession={onNewSession}
      onSwitchSession={onSwitchSession}
      contextFillPercent={contextFillPercent}
      onCompactContext={() => void onCompactContext()}
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);
