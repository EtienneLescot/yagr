import React from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useWebUiStore, type ChatMessage, type ChatProgressEntry, type ChatWorkflowEmbed, type ConfigSnapshot } from './store.js';
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
  | { type: 'text-delta'; delta: string }
  | { type: 'final'; sessionId: string; response: string; finalState: string; requiredActions?: Array<{ title: string; message: string }> }
  | { type: 'error'; error: string }
  | { type: 'embed'; kind: 'workflow'; workflowId: string; url: string; title?: string; diagram?: string };

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
    case 'validate': return 'Validating';
    case 'sync': return 'Syncing';
    case 'verify': return 'Verifying';
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
}: {
  snapshot?: ConfigSnapshot;
  busyLabel?: string;
  onOpenSetup: () => void;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
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
          <div>
            <p className="eyebrow">Session</p>
            <h2>Runtime at a glance</h2>
          </div>
          <button className="primaryButton" type="button" onClick={onOpenSetup}>Open setup</button>
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
    </aside>
  );
}

function SetupPageHeader({
  snapshot,
  onBack,
  onRefresh,
  themeMode,
  onThemeModeChange,
}: {
  snapshot?: ConfigSnapshot;
  onBack: () => void;
  onRefresh: () => void;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
}): React.JSX.Element {
  return (
    <section className="panel setupHero">
      <div>
        <p className="eyebrow">Setup</p>
        <h1>Runtime configuration</h1>
        <p className="lede">A dedicated page for orchestrator, model selection, and optional messaging surfaces.</p>
      </div>
      <div className="chatHeroActions">
        <ThemeSelector value={themeMode} onChange={onThemeModeChange} />
        <button className="ghostButton" type="button" onClick={onBack}>Back to chat</button>
        <button className="ghostButton" type="button" onClick={onRefresh}>Refresh state</button>
      </div>
      <div className="setupHeroMeta">
        <span className="messageBadge phaseBadge">{snapshot?.setupStatus.ready ? 'Runtime ready' : 'Needs onboarding'}</span>
        <span className="messageBadge quietBadge">{snapshot?.webui.url ?? '-'}</span>
      </div>
    </section>
  );
}

interface GraphNode {
  id: string;
  label: string;
  type: string;
  col: number;
  row: number;
}

interface GraphEdge {
  from: string;
  to: string;
  isLoop?: boolean;
}

function normalizeWorkflowMapLine(line: string): string {
  return line
    .replace(/^\s*\/\*+\s?/, '')
    .replace(/^\s*\*\/?\s?/, '')
    .replace(/^\s*\/\/?\s?/, '')
    .replace(/\s*\*\/\s*$/, '')
    .trimEnd();
}

function parseWorkflowMap(diagram: string): { nodes: GraphNode[]; edges: GraphEdge[] } | null {
  const lines = diagram.split('\n').map(normalizeWorkflowMapLine);

  // Parse NODE INDEX: lines like "  PropertyName                  nodeType"
  const nodeIndex = new Map<string, string>();
  let inNodeIndex = false;
  for (const line of lines) {
    if (line.trim().startsWith('NODE INDEX')) { inNodeIndex = true; continue; }
    if (line.trim().startsWith('ROUTING MAP')) { inNodeIndex = false; continue; }
    if (/^[\s\-_=─]+$/.test(line.trim()) || line.trim().startsWith('Property name')) continue;
    if (!inNodeIndex) continue;
    const match = line.match(/^\s*(\S+)\s{2,}(\S+)/);
    if (match) nodeIndex.set(match[1], match[2]);
  }

  // Parse ROUTING MAP: indented "→ NodeName" and ".out(N) → NodeName" lines
  const edges: GraphEdge[] = [];
  const parentStack: string[] = [];
  let inRouting = false;
  const orderedNames: string[] = [];
  for (const line of lines) {
    if (line.trim().startsWith('ROUTING MAP')) { inRouting = true; continue; }
    if (line.trim().startsWith('<workflow-map>') || line.trim().startsWith('</workflow-map>')) continue;
    if (line.trim().startsWith('AI CONNECTIONS')) break;
    if (!inRouting) continue;
    if (/^[\s\-_=─]+$/.test(line.trim()) || !line.trim()) continue;

    const isLoop = line.includes('(↩ loop)');
    // Match ".out(N) → NodeName" (alternate output branches) as well as plain "→ NodeName"
    const arrowMatch = line.match(/^(\s*)\.out\(\d+\)\s+(?:→|->)\s*(\S+)/) ?? line.match(/^(\s*)(?:→|->)\s*(\S+)/);
    if (arrowMatch) {
      const depth = Math.floor(arrowMatch[1].length / 2);
      const name = arrowMatch[2];
      if (!isLoop) orderedNames.push(name);
      if (depth <= parentStack.length && parentStack.length > 0) {
        parentStack.length = depth;
      }
      if (parentStack.length > 0) {
        edges.push({ from: parentStack[parentStack.length - 1], to: name, isLoop });
      }
      if (!isLoop) parentStack.push(name);
    } else {
      // Root node (no arrow)
      const rootMatch = line.match(/^\s*(\S+)\s*$/);
      if (rootMatch) {
        parentStack.length = 0;
        parentStack.push(rootMatch[1]);
        orderedNames.push(rootMatch[1]);
      }
    }
  }

  if (orderedNames.length === 0) return null;

  // Build graph nodes — position by layer (column) from forward edges only (back-edges excluded to avoid infinite loop)
  const layerMap = new Map<string, number>();
  for (const name of orderedNames) {
    if (!layerMap.has(name)) layerMap.set(name, 0);
  }
  const forwardEdges = edges.filter((e) => !e.isLoop);
  // Forward pass: each target is at least source+1; bounded by O(V²) in the worst case for a DAG
  let changed = true;
  let iters = 0;
  const maxIters = orderedNames.length * orderedNames.length + 1;
  while (changed && iters++ < maxIters) {
    changed = false;
    for (const e of forwardEdges) {
      const s = layerMap.get(e.from) ?? 0;
      const t = layerMap.get(e.to) ?? 0;
      if (t <= s) {
        layerMap.set(e.to, s + 1);
        changed = true;
      }
    }
  }
  // Group by column, assign rows
  const columns = new Map<number, string[]>();
  for (const name of orderedNames) {
    const col = layerMap.get(name) ?? 0;
    if (!columns.has(col)) columns.set(col, []);
    if (!columns.get(col)!.includes(name)) columns.get(col)!.push(name);
  }

  const nodes: GraphNode[] = [];
  for (const [col, names] of columns) {
    names.forEach((name, row) => {
      nodes.push({ id: name, label: name, type: nodeIndex.get(name) ?? '', col, row });
    });
  }

  return { nodes, edges };
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

  const pos = (n: GraphNode) => ({
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

function WorkflowHeader({ embed }: { embed: ChatWorkflowEmbed }): React.JSX.Element {
  return (
    <div className="workflowCard">
      <div className="workflowHeader">
        <div className="workflowHeaderLeft">
          <span className="workflowBadge">Workflow</span>
          <span className="workflowTitle">{embed.title ?? `Workflow ${embed.workflowId}`}</span>
        </div>
        <a className="primaryButton" href={embed.url} target="_blank" rel="noreferrer">
          Open in n8n
        </a>
      </div>
      {embed.diagram ? (
        <div className="workflowGraphWrap">
          <WorkflowGraph diagram={embed.diagram} />
        </div>
      ) : null}
    </div>
  );
}

function MessageCard({ message, now }: { message: ChatMessage; now: number }): React.JSX.Element {
  const elapsed = message.streaming && message.startedAt ? formatElapsed(now - message.startedAt) : undefined;
  const visibleProgress = (message.progress ?? []).slice(-3);
  const previewLines = message.streaming ? buildStreamingPreview(message.text) : [];
  const showProgress = message.streaming || message.finalState === 'failed_terminal';
  const showBody = !message.streaming || (previewLines.length === 0 && visibleProgress.length === 0);

  return (
    <article className={`message ${message.role}${message.streaming ? ' streaming' : ''}`}>
      <div className="messageTopline">
        <div className="messageRole">{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Yagr' : 'System'}</div>
        {message.role === 'assistant' && (message.phase || message.statusLabel || elapsed) ? (
          <div className="messageBadges">
            {message.phase ? <span className="messageBadge phaseBadge">{phaseLabel(message.phase)}</span> : null}
            {message.statusLabel ? <span className="messageBadge">{message.statusLabel}</span> : null}
            {elapsed ? <span className="messageBadge quietBadge">{elapsed}</span> : null}
          </div>
        ) : null}
      </div>

      {message.role === 'assistant' && message.streaming ? (
        <div className="workbench compactWorkbench">
          <div className="workGlyph" aria-hidden="true">
            <span className="workGlyphCore" />
            <span className="workGlyphRing workGlyphRingA" />
            <span className="workGlyphRing workGlyphRingB" />
          </div>
          <div className="workMeta">
            <strong>{message.statusLabel ?? 'Yagr is working'}</strong>
            <span className="muted">Compact live trace, without dumping the full internal reasoning.</span>
          </div>
        </div>
      ) : null}

      {showProgress && visibleProgress.length > 0 ? (
        <div className="progressTicker">
          {visibleProgress.map((entry) => (
            <div key={entry.id} className={`progressTickerEntry ${entry.tone}`}>
              <span className="progressDot" aria-hidden="true" />
              <span>{entry.detail ?? entry.title}</span>
            </div>
          ))}
        </div>
      ) : null}

      {message.streaming && previewLines.length > 0 ? (
        <div className="streamPreview">
          {previewLines.map((line, index) => <div key={`${message.id}:preview:${index}`}>{line}</div>)}
        </div>
      ) : null}

      {showBody ? (
        <div className={`messageText${!message.text && message.streaming ? ' placeholder' : ''}`}>
          {message.text
            ? <MarkdownBody text={message.text} />
            : (message.streaming ? 'The answer is being composed...' : '')}
        </div>
      ) : null}

      {message.embed ? <WorkflowHeader embed={message.embed} /> : null}
    </article>
  );
}

function HomePage({
  snapshot,
  messages,
  now,
  busyLabel,
  runActive,
  chatInput,
  onChatInputChange,
  onSendMessage,
  onStopRun,
  onResetChat,
  onOpenSetup,
  chatLogRef,
  themeMode,
  onThemeModeChange,
}: {
  snapshot?: ConfigSnapshot;
  messages: ChatMessage[];
  now: number;
  busyLabel?: string;
  runActive: boolean;
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSendMessage: (event: React.FormEvent) => void;
  onStopRun: () => void;
  onResetChat: () => void;
  onOpenSetup: () => void;
  chatLogRef: React.RefObject<HTMLDivElement | null>;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
}): React.JSX.Element {
  return (
    <div className="shell shellHome">
      <SessionSidebar
        snapshot={snapshot}
        busyLabel={busyLabel}
        onOpenSetup={onOpenSetup}
        themeMode={themeMode}
        onThemeModeChange={onThemeModeChange}
      />

      <main className="chatStage">
        <section className="panel chatPanel chatPanelSingleScroll">
          <div className="chatLog" ref={chatLogRef}>
            {messages.map((message) => <MessageCard key={message.id} message={message} now={now} />)}
          </div>

          <form className="composer composerDocked" onSubmit={(event) => void onSendMessage(event)}>
            <textarea
              value={chatInput}
              onChange={(event) => onChatInputChange(event.target.value)}
              rows={4}
              placeholder="Ask Yagr to inspect, create, validate, or evolve an automation..."
            />
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

  return (
    <div className="shell shellSetup">
      <main className="setupStage">
        <SetupPageHeader
          snapshot={snapshot}
          onBack={onBack}
          onRefresh={onRefresh}
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
              <p className="hint">This writes the current n8n connection used by onboarding and by the runtime.</p>
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
                <input value={model} onChange={(event) => onModelChange(event.target.value)} type="text" list="llm-model-list" placeholder="gpt-5.1 / claude / gemini..." />
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
              <label className="checkboxRow disabledRow">
                <input type="checkbox" disabled />
                <span>WhatsApp soon</span>
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

function App() {
  const {
    sessionId,
    snapshot,
    n8nProjects,
    availableModels,
    messages,
    busyLabel,
    setBusyLabel,
    setError,
    setSnapshot,
    setProjects,
    setAvailableModels,
    pushMessage,
    patchMessage,
    appendMessageText,
    pushMessageProgress,
    resetMessages,
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

  const [provider, setProvider] = React.useState('openrouter');
  const [llmApiKey, setLlmApiKey] = React.useState('');
  const [model, setModel] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState('');

  const [enableTelegram, setEnableTelegram] = React.useState(false);
  const [telegramBotToken, setTelegramBotToken] = React.useState('');

  const [chatInput, setChatInput] = React.useState('');
  const [now, setNow] = React.useState(() => Date.now());
  const runActive = React.useMemo(() => messages.some((message) => message.streaming), [messages]);

  React.useEffect(() => {
    applyThemeMode(themeMode);
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  React.useEffect(() => {
    if (!messages.some((message) => message.streaming)) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [messages]);

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
  }, [messages]);

  const hydrate = React.useCallback((nextSnapshot: ConfigSnapshot) => {
    setSnapshot(nextSnapshot);
    setN8nHost(nextSnapshot.n8n.host ?? '');
    setN8nApiKey('');
    setN8nProjectId(nextSnapshot.n8n.projectId ?? '');
    setN8nSyncFolder(nextSnapshot.n8n.syncFolder ?? 'workflows');
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

  const onLoadProjects = async () => {
    setBusyLabel('Loading n8n projects...');
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
        body: JSON.stringify({ host: n8nHost, apiKey: n8nApiKey || undefined, projectId: n8nProjectId, syncFolder: n8nSyncFolder }),
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
      resetMessages();
      notify('Conversation reset.');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusyLabel(undefined);
    }
  };

  const onSendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (activeStreamRef.current) {
      return;
    }

    const trimmed = chatInput.trim();
    if (!trimmed) {
      return;
    }

    const pendingId = crypto.randomUUID();
    pushMessage({ id: crypto.randomUUID(), role: 'user', text: trimmed });
    pushMessage({
      id: pendingId,
      role: 'assistant',
      text: '',
      streaming: true,
      phase: 'inspect',
      statusLabel: 'Starting run...',
      startedAt: Date.now(),
      progress: [],
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
          patchMessage(pendingId, { statusLabel: streamEvent.message, phase: 'inspect' });
          setBusyLabel(streamEvent.message);
          return;
        }

        if (streamEvent.type === 'phase') {
          if (streamEvent.status === 'started') {
            patchMessage(pendingId, {
              phase: streamEvent.phase,
              statusLabel: streamEvent.message,
            });
            pushMessageProgress(pendingId, {
              id: crypto.randomUUID(),
              tone: 'info',
              title: phaseLabel(streamEvent.phase),
              detail: streamEvent.message,
            });
            setBusyLabel(streamEvent.message);
          }
          return;
        }

        if (streamEvent.type === 'state') {
          if (streamEvent.state === 'failed_terminal' || streamEvent.state === 'resumable') {
            pushMessageProgress(pendingId, {
              id: crypto.randomUUID(),
              tone: streamEvent.state === 'failed_terminal' ? 'error' : 'info',
              title: streamEvent.state === 'failed_terminal' ? 'Run failed' : 'Needs attention',
              detail: streamEvent.message,
            });
          }
          patchMessage(pendingId, { statusLabel: streamEvent.message });
          setBusyLabel(streamEvent.message);
          return;
        }

        if (streamEvent.type === 'progress') {
          pushMessageProgress(pendingId, {
            id: crypto.randomUUID(),
            tone: streamEvent.tone,
            title: streamEvent.title,
            detail: streamEvent.detail,
          });
          patchMessage(pendingId, {
            phase: streamEvent.phase ?? undefined,
            statusLabel: streamEvent.detail ?? streamEvent.title,
          });
          setBusyLabel(streamEvent.detail ?? streamEvent.title);
          return;
        }

        if (streamEvent.type === 'embed') {
          patchMessage(pendingId, {
            embed: {
              kind: streamEvent.kind,
              workflowId: streamEvent.workflowId,
              url: streamEvent.url,
              title: streamEvent.title,
              diagram: streamEvent.diagram,
            },
          });
          return;
        }

        if (streamEvent.type === 'text-delta') {
          appendMessageText(pendingId, streamEvent.delta);
          return;
        }

        if (streamEvent.type === 'final') {
          const statusLabel = streamEvent.finalState === 'stopped'
            ? 'Stopped'
            : streamEvent.finalState === 'failed_terminal'
              ? 'Run failed'
              : (streamEvent.requiredActions?.length ? 'Needs attention' : 'Completed');

          patchMessage(pendingId, {
            text: streamEvent.response,
            streaming: false,
            finalState: streamEvent.finalState,
            statusLabel,
            phase: undefined,
          });
          setBusyLabel(undefined);
          if (streamEvent.requiredActions?.length) {
            notify('Yagr returned required actions. Review the response details.', 'error');
          }
          return;
        }

        patchMessage(pendingId, {
          role: 'system',
          text: streamEvent.error,
          streaming: false,
          finalState: 'failed_terminal',
          statusLabel: 'Run failed',
          phase: undefined,
        });
        setBusyLabel(undefined);
        notify(streamEvent.error, 'error');
      });
    } catch (error) {
      if (isAbortError(error)) {
        const currentMessage = useWebUiStore.getState().messages.find((message) => message.id === pendingId);
        patchMessage(pendingId, {
          text: currentMessage?.text.trim() ? currentMessage.text : 'Run stopped.',
          streaming: false,
          finalState: 'stopped',
          statusLabel: 'Stopped',
          phase: undefined,
        });
      } else {
        patchMessage(pendingId, {
          role: 'system',
          text: error instanceof Error ? error.message : String(error),
          streaming: false,
          finalState: 'failed_terminal',
          statusLabel: 'Run failed',
          phase: undefined,
        });
        notify(error instanceof Error ? error.message : String(error), 'error');
      }
    } finally {
      activeStreamRef.current = null;
      setBusyLabel(undefined);
    }
  };

  const onStopRun = React.useCallback(() => {
    if (!activeStreamRef.current) {
      return;
    }

    setBusyLabel('Stopping run...');
    activeStreamRef.current.abort();
  }, [setBusyLabel]);

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
      messages={messages}
      now={now}
      busyLabel={busyLabel}
      runActive={runActive}
      chatInput={chatInput}
      onChatInputChange={setChatInput}
      onSendMessage={onSendMessage}
      onStopRun={onStopRun}
      onResetChat={() => void onResetChat()}
      onOpenSetup={() => setView('setup')}
      chatLogRef={chatLogRef}
      themeMode={themeMode}
      onThemeModeChange={setThemeMode}
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);