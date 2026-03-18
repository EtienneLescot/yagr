import { create } from 'zustand';

export type Provider = 'anthropic' | 'openai' | 'google' | 'groq' | 'mistral' | 'openrouter';

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
    apiKeyStored: boolean;
    projects: Array<{ id: string; name: string }>;
  };
  availableModels: string[];
}

export interface ChatWorkflowEmbed {
  kind: 'workflow';
  workflowId: string;
  url: string;
  title?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  streaming?: boolean;
  phase?: string;
  statusLabel?: string;
  startedAt?: number;
  finalState?: string;
  progress?: ChatProgressEntry[];
  embed?: ChatWorkflowEmbed;
}

export interface ChatProgressEntry {
  id: string;
  tone: 'info' | 'success' | 'error';
  title: string;
  detail?: string;
}

interface WebUiState {
  sessionId: string;
  snapshot?: ConfigSnapshot;
  n8nProjects: Array<{ id: string; name: string }>;
  availableModels: string[];
  messages: ChatMessage[];
  busyLabel?: string;
  error?: string;
  setBusyLabel: (value?: string) => void;
  setError: (value?: string) => void;
  setSnapshot: (snapshot: ConfigSnapshot) => void;
  setProjects: (projects: Array<{ id: string; name: string }>) => void;
  setAvailableModels: (models: string[]) => void;
  pushMessage: (message: ChatMessage) => void;
  patchMessage: (id: string, patch: Partial<ChatMessage>) => void;
  appendMessageText: (id: string, text: string) => void;
  pushMessageProgress: (id: string, entry: ChatProgressEntry) => void;
  replaceMessage: (id: string, text: string, role?: ChatMessage['role']) => void;
  resetMessages: () => void;
}

const initialSessionId = window.localStorage.getItem('yagr-web-session') ?? crypto.randomUUID();
window.localStorage.setItem('yagr-web-session', initialSessionId);

export const useWebUiStore = create<WebUiState>((set) => ({
  sessionId: initialSessionId,
  n8nProjects: [],
  availableModels: [],
  messages: [
    {
      id: crypto.randomUUID(),
      role: 'system',
      text: 'Yagr Web UI ready. Configure the runtime or start chatting.',
    },
  ],
  setBusyLabel: (busyLabel) => set({ busyLabel }),
  setError: (error) => set({ error }),
  setSnapshot: (snapshot) => set({
    snapshot,
    n8nProjects: snapshot.n8n.projects,
    availableModels: snapshot.availableModels,
  }),
  setProjects: (n8nProjects) => set({ n8nProjects }),
  setAvailableModels: (availableModels) => set({ availableModels }),
  pushMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  patchMessage: (id, patch) => set((state) => ({
    messages: state.messages.map((message) => message.id === id ? { ...message, ...patch } : message),
  })),
  appendMessageText: (id, text) => set((state) => ({
    messages: state.messages.map((message) => message.id === id ? { ...message, text: `${message.text}${text}` } : message),
  })),
  pushMessageProgress: (id, entry) => set((state) => ({
    messages: state.messages.map((message) => {
      if (message.id !== id) {
        return message;
      }

      const previousEntry = message.progress?.[message.progress.length - 1];
      if (
        previousEntry
        && previousEntry.tone === entry.tone
        && previousEntry.title === entry.title
        && previousEntry.detail === entry.detail
      ) {
        return message;
      }

      const nextProgress = [...(message.progress ?? []), entry].slice(-3);
      return {
        ...message,
        progress: nextProgress,
      };
    }),
  })),
  replaceMessage: (id, text, role) => set((state) => ({
    messages: state.messages.map((message) => message.id === id ? { ...message, text, role: role ?? message.role } : message),
  })),
  resetMessages: () => set({
    messages: [
      {
        id: crypto.randomUUID(),
        role: 'system',
        text: 'Conversation reset.',
      },
    ],
  }),
}));