import React from 'react';
import { createRoot } from 'react-dom/client';
import { useWebUiStore } from './store.js';

type ApiError = { error?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
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
  return React.useEffectEvent((message: string, tone: 'info' | 'error' = 'info') => {
    const notice = document.createElement('div');
    notice.className = 'notice';
    notice.textContent = message;
    if (tone === 'error') {
      notice.style.background = 'linear-gradient(135deg, rgba(138, 28, 70, 0.96), rgba(78, 27, 143, 0.96))';
    }
    document.body.appendChild(notice);
    window.setTimeout(() => notice.remove(), 3600);
  });
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
    replaceMessage,
    resetMessages,
  } = useWebUiStore();

  const notify = useNotice();

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

  const hydrate = React.useEffectEvent((nextSnapshot: typeof snapshot extends undefined ? never : NonNullable<typeof snapshot>) => {
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
  });

  const refreshConfig = React.useEffectEvent(async () => {
    setBusyLabel('Refreshing state...');
    try {
      const nextSnapshot = await request<any>('/api/config');
      hydrate(nextSnapshot);
      setError(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      notify(message, 'error');
    } finally {
      setBusyLabel(undefined);
    }
  });

  React.useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  const onLoadProjects = React.useEffectEvent(async () => {
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
  });

  const onSaveN8n = React.useEffectEvent(async () => {
    setBusyLabel('Saving orchestrator connection...');
    try {
      const result = await request<{ warning?: string; snapshot: any }>('/api/config/n8n', {
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
  });

  const onLoadModels = React.useEffectEvent(async () => {
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
  });

  const onSaveLlm = React.useEffectEvent(async () => {
    setBusyLabel('Saving model config...');
    try {
      const result = await request<{ snapshot: any }>('/api/config/llm', {
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
  });

  const onSaveSurfaces = React.useEffectEvent(async () => {
    setBusyLabel('Saving surfaces...');
    try {
      const enabledSurfaces = [enableTelegram ? 'telegram' : null].filter(Boolean);
      const result = await request<{ snapshot: any }>('/api/config/surfaces', {
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
  });

  const onConfigureTelegram = React.useEffectEvent(async () => {
    setBusyLabel('Configuring Telegram...');
    try {
      const result = await request<{ snapshot: any }>('/api/telegram/configure', {
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
  });

  const onResetTelegram = React.useEffectEvent(async () => {
    setBusyLabel('Resetting Telegram...');
    try {
      const result = await request<{ snapshot: any }>('/api/telegram/reset', {
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
  });

  const onResetChat = React.useEffectEvent(async () => {
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
  });

  const onSendMessage = React.useEffectEvent(async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed) {
      return;
    }

    const pendingId = crypto.randomUUID();
    pushMessage({ id: crypto.randomUUID(), role: 'user', text: trimmed });
    pushMessage({ id: pendingId, role: 'assistant', text: 'Working...' });
    setChatInput('');
    setBusyLabel('Yagr is working...');

    try {
      const result = await request<{ response: string; requiredActions?: Array<{ title: string; message: string }> }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ sessionId, message: trimmed }),
      });
      replaceMessage(pendingId, result.response);
      if (result.requiredActions?.length) {
        notify('Yagr returned required actions. Review the response details.', 'error');
      }
    } catch (error) {
      replaceMessage(pendingId, error instanceof Error ? error.message : String(error), 'system');
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusyLabel(undefined);
    }
  });

  const setupMissing = snapshot?.setupStatus.missingSteps.join(', ') || 'No missing steps';
  const telegramLink = snapshot?.telegram.deepLink;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brandCard panel">
          <div className="brandMark" aria-hidden="true" />
          <div>
            <p className="eyebrow">Yagr Web UI</p>
            <h1>Grounded in reliable infrastructure.</h1>
            <p className="lede">Configure the runtime, wire Telegram, and chat with the same Yagr agent from a clean local surface.</p>
          </div>
        </div>

        <div className="statusGrid">
          <article className="panel statusPanel">
            <p className="eyebrow">Runtime</p>
            <div className="metricRow">
              <strong>{snapshot?.setupStatus.ready ? 'Ready' : 'Needs onboarding'}</strong>
              <span className="muted">{setupMissing}</span>
            </div>
          </article>
          <article className="panel statusPanel">
            <p className="eyebrow">Launch</p>
            <div className="metricRow">
              <strong>Web UI and TUI available</strong>
              <span className="muted">{snapshot?.webui.url ?? '-'}</span>
            </div>
          </article>
        </div>

        <section className="panel formPanel">
          <div className="sectionHeader">
            <p className="eyebrow">Current orchestrator</p>
            <button className="ghostButton" type="button" onClick={() => void onLoadProjects()}>Load projects</button>
          </div>
          <label>
            <span>Instance URL</span>
            <input value={n8nHost} onChange={(event) => setN8nHost(event.target.value)} type="url" placeholder="https://your-n8n.example.com" />
          </label>
          <label>
            <span>API key</span>
            <input value={n8nApiKey} onChange={(event) => setN8nApiKey(event.target.value)} type="password" placeholder="Leave empty to reuse saved key" />
          </label>
          <label>
            <span>Project</span>
            <select value={n8nProjectId} onChange={(event) => setN8nProjectId(event.target.value)}>
              <option value="">Load projects first</option>
              {n8nProjects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Local sync folder</span>
            <input value={n8nSyncFolder} onChange={(event) => setN8nSyncFolder(event.target.value)} type="text" placeholder="workflows" />
          </label>
          <button className="primaryButton" type="button" onClick={() => void onSaveN8n()}>Save orchestrator</button>
          <p className="hint">This writes the current n8n-based orchestrator connection that onboarding uses today.</p>
        </section>

        <section className="panel formPanel">
          <div className="sectionHeader">
            <p className="eyebrow">LLM</p>
            <button className="ghostButton" type="button" onClick={() => void onLoadModels()}>Load models</button>
          </div>
          <label>
            <span>Provider</span>
            <select value={provider} onChange={(event) => setProvider(event.target.value)}>
              {(snapshot?.yagr.providers ?? []).map((entry) => (
                <option key={entry.provider} value={entry.provider}>{entry.provider}</option>
              ))}
            </select>
          </label>
          <label>
            <span>API key</span>
            <input value={llmApiKey} onChange={(event) => setLlmApiKey(event.target.value)} type="password" placeholder="Leave empty to reuse saved key" />
          </label>
          <label>
            <span>Model</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} type="text" list="llm-model-list" placeholder="gpt-5.1 / claude / gemini..." />
            <datalist id="llm-model-list">
              {availableModels.map((entry) => <option key={entry} value={entry} />)}
            </datalist>
          </label>
          <label>
            <span>Base URL</span>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} type="url" placeholder="Optional custom base URL" />
          </label>
          <button className="primaryButton" type="button" onClick={() => void onSaveLlm()}>Save model config</button>
        </section>

        <section className="panel formPanel">
          <p className="eyebrow">Optional integrations</p>
          <label className="checkboxRow">
            <input checked={enableTelegram} onChange={(event) => setEnableTelegram(event.target.checked)} type="checkbox" />
            <span>Telegram</span>
          </label>
          <label className="checkboxRow disabledRow">
            <input type="checkbox" disabled />
            <span>WhatsApp soon</span>
          </label>
          <button className="primaryButton" type="button" onClick={() => void onSaveSurfaces()}>Save surfaces</button>
          <p className="hint">The Web UI and TUI are always available. This section only controls extra messaging integrations.</p>
        </section>

        <section className="panel formPanel">
          <div className="sectionHeader">
            <p className="eyebrow">Telegram</p>
            <button className="ghostButton dangerButton" type="button" onClick={() => void onResetTelegram()}>Reset</button>
          </div>
          <label>
            <span>Bot token</span>
            <input value={telegramBotToken} onChange={(event) => setTelegramBotToken(event.target.value)} type="password" placeholder="123456:ABC..." />
          </label>
          <button className="primaryButton" type="button" onClick={() => void onConfigureTelegram()}>Configure Telegram</button>
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
      </aside>

      <main className="chatColumn">
        <section className="chatHero panel">
          <div>
            <p className="eyebrow">Conversation</p>
            <h2>Chat with Yagr while tuning the runtime.</h2>
            <p className="lede">The same agent loop is available here: update the backend, switch provider or model, link Telegram, then ask Yagr to work.</p>
          </div>
          <div className="chatHeroActions">
            <button className="ghostButton" type="button" onClick={() => void refreshConfig()}>Refresh state</button>
            <button className="ghostButton" type="button" onClick={() => void onResetChat()}>Reset chat</button>
          </div>
        </section>

        <section className="panel chatPanel">
          <div className="chatLog">
            {messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <div className="messageRole">{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Yagr' : 'System'}</div>
                <div className="messageText">{message.text}</div>
              </article>
            ))}
          </div>
          <form className="composer" onSubmit={(event) => void onSendMessage(event)}>
            <textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} rows={4} placeholder="Ask Yagr to inspect, create, validate, or evolve an automation..." />
            <div className="composerActions">
              <span className="muted">{busyLabel ?? 'Runtime idle'}</span>
              <button className="primaryButton" type="submit">Send</button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);