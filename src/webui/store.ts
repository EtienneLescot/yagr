import { create } from 'zustand';

import type { YagrModelProvider as Provider } from '../llm/provider-registry.js';

export interface ConfigSnapshot {
  setupStatus: {
    ready: boolean;
    missingSteps: string[];
  };
  gatewayStatus: {
    enabledSurfaces: string[];
    startableSurfaces: string[];
  };
  telegram: {
    botUsername?: string;
    linkedChats: Array<{ chatId: string }>;
    deepLink?: string;
  };
  webui: {
    url: string;
  };
  yagr: {
    provider?: Provider;
    model?: string;
    baseUrl?: string;
    providers: Array<{ provider: Provider; apiKeyStored: boolean }>;
  };
  n8n: {
    host?: string;
    syncFolder?: string;
    projectId?: string;
    projectName?: string;
    instanceProfile?: 'yagr-managed-docker' | 'yagr-managed-direct' | 'custom-local-docker' | 'custom-local-direct' | 'custom-cloud';
    apiKeyStored: boolean;
    projects: Array<{ id: string; name: string }>;
  };
  availableModels: string[];
}

export interface ChatWorkflowEmbed {
  kind: 'workflow';
  workflowId: string;
  url: string;
  openUrl?: string;
  targetUrl?: string;
  title?: string;
  diagram?: string;
  executionResult?: {
    status: 'success' | 'error' | 'waiting';
    executionId?: string;
    summary?: string;
    data?: string;
  };
}

export interface ChatProgressEntry {
  id: string;
  tone: 'info' | 'success' | 'error';
  title: string;
  detail?: string;
  category?: string;
  status?: 'running' | 'done' | 'error';
  body?: string;
  summary?: string;
  startedAt?: number;
  endedAt?: number;
}

export type ThreadEntry =
  | { kind: 'user-message'; id: string; text: string; timestamp?: number }
  | { kind: 'system-notice'; id: string; text: string; timestamp?: number }
  | { kind: 'assistant-header'; id: string; streaming: boolean; statusLabel?: string; phase?: string; startedAt?: number }
  | { kind: 'operation'; id: string; entry: ChatProgressEntry }
  | { kind: 'assistant-body'; id: string; text: string; streaming: boolean; finalState?: string; embed?: ChatWorkflowEmbed };

interface WebUiState {
  sessionId: string;
  viewSessionId: string;
  snapshot?: ConfigSnapshot;
  n8nProjects: Array<{ id: string; name: string }>;
  availableModels: string[];
  thread: ThreadEntry[];
  viewThread: ThreadEntry[] | null;
  busyLabel?: string;
  error?: string;
  setBusyLabel: (value?: string) => void;
  setError: (value?: string) => void;
  setSnapshot: (snapshot: ConfigSnapshot) => void;
  setProjects: (projects: Array<{ id: string; name: string }>) => void;
  setAvailableModels: (models: string[]) => void;
  pushEntry: (entry: ThreadEntry) => void;
  patchEntry: (id: string, patch: Partial<ThreadEntry>) => void;
  appendBodyText: (id: string, text: string) => void;
  upsertOperation: (id: string, entry: ChatProgressEntry, beforeId?: string) => void;
  setThread: (thread: ThreadEntry[]) => void;
  resetThread: () => void;
  setSessionHistory: (sessions: SessionHistoryEntry[]) => void;
  switchSession: (sessionId: string) => void;
  browseSession: (sessionId: string) => void;
  setViewThread: (thread: ThreadEntry[] | null) => void;
  returnToActiveSession: () => void;
}

export interface SessionHistoryEntry {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

const SESSION_KEY = 'yagr-web-session';
const TAB_FLAG = 'yagr:tab-initialized';

const isNewTab = !window.sessionStorage.getItem(TAB_FLAG);
window.sessionStorage.setItem(TAB_FLAG, '1');

export const isNewTabOpen = isNewTab;

const initialSessionId = isNewTab
  ? (() => {
      const id = crypto.randomUUID();
      window.localStorage.setItem(SESSION_KEY, id);
      return id;
    })()
  : window.localStorage.getItem(SESSION_KEY) ?? (() => {
      const id = crypto.randomUUID();
      window.localStorage.setItem(SESSION_KEY, id);
      return id;
    })();

export const useWebUiStore = create<WebUiState>((set) => ({
  sessionId: initialSessionId,
  viewSessionId: initialSessionId,
  n8nProjects: [],
  availableModels: [],
  sessionHistory: [],
  thread: [
    {
      kind: 'system-notice',
      id: crypto.randomUUID(),
      text: 'Yagr Web UI ready. Configure the runtime or start chatting.',
    },
  ],
  viewThread: null,
  setBusyLabel: (busyLabel) => set({ busyLabel }),
  setError: (error) => set({ error }),
  setSnapshot: (snapshot) => set({
    snapshot,
    n8nProjects: snapshot.n8n.projects,
    availableModels: snapshot.availableModels,
  }),
  setProjects: (n8nProjects) => set({ n8nProjects }),
  setAvailableModels: (availableModels) => set({ availableModels }),
  pushEntry: (entry) => set((state) => ({ thread: [...state.thread, entry] })),
  patchEntry: (id, patch) => set((state) => ({
    thread: state.thread.map((entry) => entry.id === id ? { ...entry, ...patch } as ThreadEntry : entry),
  })),
  appendBodyText: (id, text) => set((state) => ({
    thread: state.thread.map((entry) => {
      if (entry.kind !== 'assistant-body' || entry.id !== id) return entry;
      return { ...entry, text: `${entry.text}${text}` };
    }),
  })),
  upsertOperation: (id, entry, beforeId) => set((state) => {
    const existingIdx = state.thread.findIndex((e) => e.kind === 'operation' && e.id === id);
    if (existingIdx >= 0) {
      const next = [...state.thread];
      next[existingIdx] = { kind: 'operation', id, entry: { ...state.thread[existingIdx].entry, ...entry } };
      return { thread: next };
    }
    if (beforeId) {
      const beforeIdx = state.thread.findIndex((e) => e.id === beforeId);
      if (beforeIdx >= 0) {
        const next = [...state.thread];
        next.splice(beforeIdx, 0, { kind: 'operation', id, entry });
        return { thread: next };
      }
    }
    return { thread: [...state.thread, { kind: 'operation', id, entry }] };
  }),
  setThread: (thread) => set({ thread }),
  resetThread: () => set({
    thread: [
      {
        kind: 'system-notice',
        id: crypto.randomUUID(),
        text: 'Conversation reset.',
      },
    ],
  }),
  setSessionHistory: (sessionHistory) => set({ sessionHistory }),
  switchSession: (sessionId) => {
    window.localStorage.setItem(SESSION_KEY, sessionId);
    set({
      sessionId,
      viewSessionId: sessionId,
      viewThread: null,
      thread: [
        {
          kind: 'system-notice',
          id: crypto.randomUUID(),
          text: 'Loading session…',
        },
      ],
    });
  },
  browseSession: (viewSessionId) => set({
    viewSessionId,
    viewThread: [
      {
        kind: 'system-notice',
        id: crypto.randomUUID(),
        text: 'Loading session…',
      },
    ],
  }),
  setViewThread: (viewThread) => set({ viewThread }),
  returnToActiveSession: () => set((state) => ({
    viewSessionId: state.sessionId,
    viewThread: null,
  })),
}));