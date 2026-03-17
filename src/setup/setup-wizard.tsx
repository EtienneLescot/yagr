import type { IProject } from 'n8nac';
import { Box, Text, render, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { GatewaySurface } from '../gateway/types.js';
import type { YagrModelProvider } from '../llm/create-language-model.js';

// ─── Palette ──────────────────────────────────────────────────────────────────

const CURSOR = '▸';
const CHECK = '✓';
const DOT = '·';
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const VALID_PROVIDERS: YagrModelProvider[] = [
  'anthropic', 'openai', 'google', 'groq', 'mistral', 'openrouter',
];

const SURFACE_OPTIONS: Array<{ value: GatewaySurface; label: string; hint: string }> = [
  { value: 'telegram', label: 'Telegram', hint: 'Bot-based chat gateway' },
  { value: 'whatsapp', label: 'WhatsApp', hint: 'Configuration only — runtime coming soon' },
];

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SetupCallbacks {
  getN8nDefaults(): { url: string; apiKey?: string; projectId?: string; syncFolder?: string };
  testN8nConnection(url: string, apiKey: string): Promise<IProject[]>;
  saveN8nConfig(p: { url: string; apiKey: string; project: IProject; syncFolder: string }): Promise<void>;
  getLlmDefaults(): {
    provider?: YagrModelProvider;
    getApiKey(prov: YagrModelProvider): string | undefined;
    getDefaultModel(prov: YagrModelProvider): string;
    getBaseUrl(prov: YagrModelProvider): string | undefined;
    needsBaseUrl(prov: YagrModelProvider): boolean;
  };
  fetchModels(provider: YagrModelProvider, apiKey: string): Promise<string[]>;
  saveLlmConfig(p: { provider: YagrModelProvider; apiKey: string; model: string; baseUrl?: string }): void;
  getSurfaceDefaults(): { surfaces: GatewaySurface[] };
  setupTelegram(token: string): Promise<{ username: string }>;
  saveSurfaces(p: { surfaces: GatewaySurface[]; telegram?: { token: string; username: string } }): void;
}

export interface SetupResult {
  ok: boolean;
  telegramDeepLink?: string;
}

export function runSetupWizard(callbacks: SetupCallbacks): Promise<SetupResult> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <SetupWizard callbacks={callbacks} onDone={(result) => { unmount(); resolve(result); }} />,
    );
  });
}

// ─── Phase state machine ──────────────────────────────────────────────────────

type Phase =
  | { kind: 'n8n-url'; def: string; err?: string }
  | { kind: 'n8n-reuse-apikey'; url: string; existing: string; cursor: number }
  | { kind: 'n8n-apikey'; url: string; err?: string }
  | { kind: 'n8n-connecting'; url: string; apiKey: string }
  | { kind: 'n8n-project'; url: string; apiKey: string; projects: IProject[]; cursor: number }
  | { kind: 'n8n-syncfolder'; url: string; apiKey: string; project: IProject; def: string; err?: string }
  | { kind: 'n8n-saving'; url: string; apiKey: string; project: IProject; syncFolder: string; log?: string }
  | { kind: 'llm-provider'; initial?: YagrModelProvider; cursor: number }
  | { kind: 'llm-reuse-apikey'; provider: YagrModelProvider; existing: string; cursor: number }
  | { kind: 'llm-apikey'; provider: YagrModelProvider; err?: string }
  | { kind: 'llm-models-loading'; provider: YagrModelProvider; apiKey: string; defModel: string }
  | { kind: 'llm-model'; provider: YagrModelProvider; apiKey: string; models: string[]; defModel: string; cursor: number }
  | { kind: 'llm-baseurl'; provider: YagrModelProvider; apiKey: string; model: string; def: string; err?: string }
  | { kind: 'surfaces'; cursor: number; selected: GatewaySurface[] }
  | { kind: 'telegram-reuse-token'; surfaces: GatewaySurface[]; existing: string; cursor: number }
  | { kind: 'telegram-token'; surfaces: GatewaySurface[]; err?: string }
  | { kind: 'telegram-connecting'; surfaces: GatewaySurface[]; token: string }
  | { kind: 'done'; n8nHost: string; n8nProject: string; provider: string; model: string; surfaces: GatewaySurface[]; telegramDeepLink?: string }
  | { kind: 'cancelled'; reason: string }
  | { kind: 'error'; message: string };

function sectionFor(phase: Phase): string {
  if (phase.kind.startsWith('n8n')) return 'n8n  ·  Orchestrator';
  if (phase.kind.startsWith('llm')) return 'LLM  ·  Language Model';
  if (phase.kind.startsWith('surfaces') || phase.kind.startsWith('telegram')) return 'Gateways  ·  Messaging';
  return '';
}

function sectionIndex(phase: Phase): number {
  if (phase.kind.startsWith('n8n')) return 1;
  if (phase.kind.startsWith('llm')) return 2;
  return 3;
}

// ─── Primitive UI components ──────────────────────────────────────────────────

function Rule(): JSX.Element {
  return <Text dimColor>{'─'.repeat(56)}</Text>;
}

function Header({ phase }: { phase: Phase }): JSX.Element {
  const section = sectionFor(phase);
  const idx = sectionIndex(phase);
  const isDone = phase.kind === 'done' || phase.kind === 'cancelled' || phase.kind === 'error';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box justifyContent="space-between">
        <Text color="cyan" bold>◈  Yagr Setup</Text>
        {!isDone && (
          <Text dimColor>
            {`${idx === 1 ? '●' : '○'}${idx === 2 ? '●' : '○'}${idx === 3 ? '●' : '○'}  step ${idx} / 3`}
          </Text>
        )}
      </Box>
      {section ? (
        <Text color="cyan" dimColor>{section}</Text>
      ) : null}
      <Rule />
    </Box>
  );
}

function HintBar({ hints }: { hints: string[] }): JSX.Element {
  return (
    <Box marginTop={1}>
      <Rule />
      <Box>
        {hints.map((hint, i) => (
          <Text key={i} dimColor>{hint}{i < hints.length - 1 ? '   ' : ''}</Text>
        ))}
      </Box>
    </Box>
  );
}

function FieldLabel({ label, done }: { label: string; done?: boolean }): JSX.Element {
  return (
    <Box marginBottom={0}>
      <Text color={done ? 'green' : 'white'} bold>{done ? `${CHECK} ` : `${CURSOR} `}{label}</Text>
    </Box>
  );
}

function ErrorLine({ message }: { message: string }): JSX.Element {
  return (
    <Box marginTop={0}>
      <Text color="red">  ✕ {message}</Text>
    </Box>
  );
}

function SpinnerDisplay({ message, frame }: { message: string; frame: number }): JSX.Element {
  return (
    <Box>
      <Text color="cyan">{SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} </Text>
      <Text dimColor>{message}</Text>
    </Box>
  );
}

function SelectList<T>({
  options,
  cursor,
  getLabel,
  getHint,
}: {
  options: readonly T[];
  cursor: number;
  getLabel: (v: T) => string;
  getHint?: (v: T) => string | undefined;
}): JSX.Element {
  return (
    <Box flexDirection="column" marginTop={0} marginBottom={0}>
      {options.map((opt, i) => {
        const active = i === cursor;
        const hint = getHint?.(opt);
        return (
          <Box key={i}>
            <Text color={active ? 'cyan' : undefined} bold={active}>
              {active ? `  ${CURSOR} ` : `    `}
            </Text>
            <Text color={active ? 'cyan' : undefined} bold={active}>{getLabel(opt)}</Text>
            {hint ? <Text dimColor>  {DOT}  {hint}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}

function MultiSelectList({
  options,
  cursor,
  selected,
}: {
  options: typeof SURFACE_OPTIONS;
  cursor: number;
  selected: GatewaySurface[];
}): JSX.Element {
  return (
    <Box flexDirection="column" marginTop={0} marginBottom={0}>
      {options.map((opt, i) => {
        const active = i === cursor;
        const checked = selected.includes(opt.value);
        return (
          <Box key={opt.value}>
            <Text color={active ? 'cyan' : undefined} bold={active}>
              {active ? `  ${CURSOR} ` : `    `}
            </Text>
            <Text color={checked ? 'cyan' : undefined}>{checked ? '☑' : '☐'}  {opt.label}</Text>
            <Text dimColor>  {DOT}  {opt.hint}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── Main wizard component ────────────────────────────────────────────────────

function SetupWizard({ callbacks, onDone }: {
  callbacks: SetupCallbacks;
  onDone: (result: SetupResult) => void;
}): JSX.Element {
  const app = useApp();
  const n8nDef = callbacks.getN8nDefaults();
  const llmDef = callbacks.getLlmDefaults();
  const surfDef = callbacks.getSurfaceDefaults();

  const [phase, setPhase] = useState<Phase>({ kind: 'n8n-url', def: n8nDef.url });
  const [textValue, setTextValue] = useState(n8nDef.url);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const asyncGuard = useRef(0);

  // Spinner tick for loading phases
  const isLoading = phase.kind === 'n8n-connecting' || phase.kind === 'n8n-saving'
    || phase.kind === 'llm-models-loading' || phase.kind === 'telegram-connecting';

  useEffect(() => {
    if (!isLoading) return;
    const id = setInterval(() => setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, [isLoading]);

  // Exit helper
  const cancel = useCallback((reason: string) => {
    setPhase({ kind: 'cancelled', reason });
    setTimeout(() => { onDone({ ok: false }); app.exit(); }, 500);
  }, [app, onDone]);

  // Ctrl+C globally
  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      cancel('Setup cancelled.');
    }
  });

  // ── Async transitions ──────────────────────────────────────────────────────

  useEffect(() => {
    if (phase.kind !== 'n8n-connecting') return;
    const guard = ++asyncGuard.current;
    void (async () => {
      try {
        const projects = await callbacks.testN8nConnection(phase.url, phase.apiKey);
        if (guard !== asyncGuard.current) return;
        if (projects.length === 1) {
          setPhase({
            kind: 'n8n-syncfolder',
            url: phase.url, apiKey: phase.apiKey,
            project: projects[0],
            def: n8nDef.syncFolder ?? 'workflows',
          });
          setTextValue(n8nDef.syncFolder ?? 'workflows');
        } else {
          setPhase({ kind: 'n8n-project', url: phase.url, apiKey: phase.apiKey, projects, cursor: 0 });
        }
      } catch (err) {
        if (guard !== asyncGuard.current) return;
        setPhase({ kind: 'n8n-url', def: phase.url, err: (err as Error).message });
        setTextValue(phase.url);
      }
    })();
  }, [phase.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase.kind !== 'n8n-saving') return;
    const guard = ++asyncGuard.current;
    void (async () => {
      try {
        await callbacks.saveN8nConfig({ url: phase.url, apiKey: phase.apiKey, project: phase.project, syncFolder: phase.syncFolder });
        if (guard !== asyncGuard.current) return;
        const llmProvider = llmDef.provider;
        setPhase({ kind: 'llm-provider', initial: llmProvider, cursor: llmProvider ? VALID_PROVIDERS.indexOf(llmProvider) : 0 });
      } catch (err) {
        if (guard !== asyncGuard.current) return;
        setPhase({ kind: 'error', message: (err as Error).message });
        setTimeout(() => { onDone({ ok: false }); app.exit(); }, 2000);
      }
    })();
  }, [phase.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase.kind !== 'llm-models-loading') return;
    const guard = ++asyncGuard.current;
    void (async () => {
      try {
        const models = await callbacks.fetchModels(phase.provider, phase.apiKey);
        if (guard !== asyncGuard.current) return;
        const idx = models.indexOf(phase.defModel);
        setPhase({
          kind: 'llm-model',
          provider: phase.provider, apiKey: phase.apiKey,
          models, defModel: phase.defModel,
          cursor: idx >= 0 ? idx : 0,
        });
      } catch {
        if (guard !== asyncGuard.current) return;
        setPhase({
          kind: 'llm-model',
          provider: phase.provider, apiKey: phase.apiKey,
          models: [], defModel: phase.defModel, cursor: 0,
        });
      }
    })();
  }, [phase.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase.kind !== 'telegram-connecting') return;
    const guard = ++asyncGuard.current;
    void (async () => {
      try {
        const identity = await callbacks.setupTelegram(phase.token);
        if (guard !== asyncGuard.current) return;
        callbacks.saveSurfaces({
          surfaces: phase.surfaces,
          telegram: { token: phase.token, username: identity.username },
        });
        const telegramDeepLink = `https://t.me/${identity.username}`;
        // Find saved n8n/llm for summary (approximate — wizard is done)
        setPhase({ kind: 'done', n8nHost: '', n8nProject: '', provider: '', model: '', surfaces: phase.surfaces, telegramDeepLink });
        setTimeout(() => { onDone({ ok: true, telegramDeepLink }); app.exit(); }, 800);
      } catch (err) {
        if (guard !== asyncGuard.current) return;
        setPhase({ kind: 'telegram-token', surfaces: phase.surfaces, err: (err as Error).message });
        setTextValue('');
      }
    })();
  }, [phase.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Input handlers (text submit) ──────────────────────────────────────────

  const handleN8nUrlSubmit = useCallback((value: string) => {
    const url = value.trim().replace(/^['"]|['"]$/g, '');
    if (!url) { setPhase((p) => ({ ...p as Extract<Phase, { kind: 'n8n-url' }>, err: 'A URL is required.' })); return; }
    try { new URL(url); } catch { setPhase((p) => ({ ...p as Extract<Phase, { kind: 'n8n-url' }>, err: 'Enter a valid URL.' })); return; }
    const existing = callbacks.getN8nDefaults().apiKey;
    if (existing) {
      setPhase({ kind: 'n8n-reuse-apikey', url, existing, cursor: 0 });
    } else {
      setPhase({ kind: 'n8n-apikey', url });
      setTextValue('');
    }
  }, [callbacks]);

  const handleN8nApiKeySubmit = useCallback((url: string) => (value: string) => {
    const key = value.trim();
    if (!key) { setPhase((p) => ({ ...p as Extract<Phase, { kind: 'n8n-apikey' }>, err: 'API key is required.' })); return; }
    setPhase({ kind: 'n8n-connecting', url, apiKey: key });
  }, []);

  const handleSyncFolderSubmit = useCallback((url: string, apiKey: string, project: IProject) => (value: string) => {
    const folder = value.trim();
    if (!folder) { setPhase((p) => ({ ...p as Extract<Phase, { kind: 'n8n-syncfolder' }>, err: 'Sync folder is required.' })); return; }
    setPhase({ kind: 'n8n-saving', url, apiKey, project, syncFolder: folder });
  }, []);

  const handleLlmApiKeySubmit = useCallback((provider: YagrModelProvider) => (value: string) => {
    const key = value.trim();
    if (!key) { setPhase((p) => ({ ...p as Extract<Phase, { kind: 'llm-apikey' }>, err: 'API key is required.' })); return; }
    const defModel = llmDef.getDefaultModel(provider);
    setPhase({ kind: 'llm-models-loading', provider, apiKey: key, defModel });
  }, [llmDef]);

  const handleBaseUrlSubmit = useCallback((provider: YagrModelProvider, apiKey: string, model: string) => (value: string) => {
    const url = value.trim();
    if (url) {
      try { new URL(url); } catch { setPhase((p) => ({ ...p as Extract<Phase, { kind: 'llm-baseurl' }>, err: 'Enter a valid URL.' })); return; }
    }
    callbacks.saveLlmConfig({ provider, apiKey, model, baseUrl: url || undefined });
    const currentSurfaces = surfDef.surfaces;
    setPhase({ kind: 'surfaces', cursor: 0, selected: currentSurfaces });
  }, [callbacks, surfDef]);

  const handleTelegramTokenSubmit = useCallback((surfaces: GatewaySurface[]) => (value: string) => {
    const token = value.trim();
    if (!token || !token.includes(':')) { setPhase((p) => ({ ...p as Extract<Phase, { kind: 'telegram-token' }>, err: 'Enter a valid BotFather token.' })); return; }
    setPhase({ kind: 'telegram-connecting', surfaces, token });
  }, []);

  // ── Select keyboard handlers ───────────────────────────────────────────────

  const handleSelectKey = useCallback((input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean }) => {
    if (phase.kind === 'n8n-reuse-apikey') {
      if (key.upArrow) setPhase({ ...phase, cursor: Math.max(0, phase.cursor - 1) });
      else if (key.downArrow) setPhase({ ...phase, cursor: Math.min(1, phase.cursor + 1) });
      else if (key.return) {
        if (phase.cursor === 0) {
          // reuse → go straight to connecting
          setPhase({ kind: 'n8n-connecting', url: phase.url, apiKey: phase.existing });
        } else {
          setPhase({ kind: 'n8n-apikey', url: phase.url });
          setTextValue('');
        }
      } else if (key.escape) cancel('Setup cancelled.');
    } else if (phase.kind === 'n8n-project') {
      if (key.upArrow) setPhase({ ...phase, cursor: Math.max(0, phase.cursor - 1) });
      else if (key.downArrow) setPhase({ ...phase, cursor: Math.min(phase.projects.length - 1, phase.cursor + 1) });
      else if (key.return) {
        const project = phase.projects[phase.cursor];
        setPhase({ kind: 'n8n-syncfolder', url: phase.url, apiKey: phase.apiKey, project, def: n8nDef.syncFolder ?? 'workflows' });
        setTextValue(n8nDef.syncFolder ?? 'workflows');
      } else if (key.escape) cancel('Setup cancelled.');
    } else if (phase.kind === 'llm-provider') {
      if (key.upArrow) setPhase({ ...phase, cursor: Math.max(0, phase.cursor - 1) });
      else if (key.downArrow) setPhase({ ...phase, cursor: Math.min(VALID_PROVIDERS.length - 1, phase.cursor + 1) });
      else if (key.return) {
        const provider = VALID_PROVIDERS[phase.cursor];
        const existing = llmDef.getApiKey(provider);
        if (existing) {
          setPhase({ kind: 'llm-reuse-apikey', provider, existing, cursor: 0 });
        } else {
          setPhase({ kind: 'llm-apikey', provider });
          setTextValue('');
        }
      } else if (key.escape) cancel('Setup cancelled.');
    } else if (phase.kind === 'llm-reuse-apikey') {
      if (key.upArrow) setPhase({ ...phase, cursor: Math.max(0, phase.cursor - 1) });
      else if (key.downArrow) setPhase({ ...phase, cursor: Math.min(1, phase.cursor + 1) });
      else if (key.return) {
        if (phase.cursor === 0) {
          const defModel = llmDef.getDefaultModel(phase.provider);
          setPhase({ kind: 'llm-models-loading', provider: phase.provider, apiKey: phase.existing, defModel });
        } else {
          setPhase({ kind: 'llm-apikey', provider: phase.provider });
          setTextValue('');
        }
      } else if (key.escape) cancel('Setup cancelled.');
    } else if (phase.kind === 'llm-model') {
      const allOptions = [...phase.models, '__custom__'];
      if (key.upArrow) setPhase({ ...phase, cursor: Math.max(0, phase.cursor - 1) });
      else if (key.downArrow) setPhase({ ...phase, cursor: Math.min(allOptions.length - 1, phase.cursor + 1) });
      else if (key.return) {
        const selected = allOptions[phase.cursor];
        const model = selected === '__custom__' ? phase.defModel : selected;
        const needsUrl = llmDef.needsBaseUrl(phase.provider);
        if (needsUrl || llmDef.getBaseUrl(phase.provider)) {
          setPhase({ kind: 'llm-baseurl', provider: phase.provider, apiKey: phase.apiKey, model, def: llmDef.getBaseUrl(phase.provider) ?? '' });
          setTextValue(llmDef.getBaseUrl(phase.provider) ?? '');
        } else {
          callbacks.saveLlmConfig({ provider: phase.provider, apiKey: phase.apiKey, model });
          setPhase({ kind: 'surfaces', cursor: 0, selected: surfDef.surfaces });
        }
      } else if (key.escape) cancel('Setup cancelled.');
    } else if (phase.kind === 'surfaces') {
      const opts = SURFACE_OPTIONS.map((o) => o.value);
      if (key.upArrow) setPhase({ ...phase, cursor: Math.max(0, phase.cursor - 1) });
      else if (key.downArrow) setPhase({ ...phase, cursor: Math.min(opts.length - 1, phase.cursor + 1) });
      else if (input === ' ') {
        const val = opts[phase.cursor];
        const next = phase.selected.includes(val)
          ? phase.selected.filter((s) => s !== val)
          : [...phase.selected, val];
        setPhase({ ...phase, selected: next });
      } else if (key.return) {
        const surfaces = phase.selected;
        if (surfaces.includes('telegram')) {
          const existingToken = callbacks.getSurfaceDefaults().surfaces.includes('telegram')
            ? (callbacks as any).getTelegramToken?.() as string | undefined
            : undefined;
          if (existingToken) {
            setPhase({ kind: 'telegram-reuse-token', surfaces, existing: existingToken, cursor: 0 });
          } else {
            setPhase({ kind: 'telegram-token', surfaces });
            setTextValue('');
          }
        } else {
          callbacks.saveSurfaces({ surfaces });
          setPhase({ kind: 'done', n8nHost: '', n8nProject: '', provider: '', model: '', surfaces });
          setTimeout(() => { onDone({ ok: true }); app.exit(); }, 500);
        }
      } else if (key.escape) cancel('Setup cancelled.');
    } else if (phase.kind === 'telegram-reuse-token') {
      if (key.upArrow) setPhase({ ...phase, cursor: Math.max(0, phase.cursor - 1) });
      else if (key.downArrow) setPhase({ ...phase, cursor: Math.min(1, phase.cursor + 1) });
      else if (key.return) {
        if (phase.cursor === 0) {
          callbacks.saveSurfaces({ surfaces: phase.surfaces });
          setPhase({ kind: 'done', n8nHost: '', n8nProject: '', provider: '', model: '', surfaces: phase.surfaces });
          setTimeout(() => { onDone({ ok: true }); app.exit(); }, 500);
        } else {
          setPhase({ kind: 'telegram-token', surfaces: phase.surfaces });
          setTextValue('');
        }
      } else if (key.escape) cancel('Setup cancelled.');
    }
  }, [phase, cancel, callbacks, llmDef, surfDef, n8nDef.syncFolder, app, onDone]);

  const isSelectPhase = ['n8n-reuse-apikey', 'n8n-project', 'llm-provider', 'llm-reuse-apikey', 'llm-model', 'surfaces', 'telegram-reuse-token'].includes(phase.kind);
  const isTextPhase = ['n8n-url', 'n8n-apikey', 'n8n-syncfolder', 'llm-apikey', 'llm-baseurl', 'telegram-token'].includes(phase.kind);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') return; // handled globally above
    if (isSelectPhase) handleSelectKey(input, key);
  }, { isActive: isSelectPhase });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Header phase={phase} />
      {renderPhase()}
    </Box>
  );

  function renderPhase(): JSX.Element {
    switch (phase.kind) {

      // ── N8n URL ─────────────────────────────────────────────────────────
      case 'n8n-url':
        return (
          <Box flexDirection="column">
            <FieldLabel label="Instance URL" />
            <Box marginLeft={2}>
              <TextInput
                value={textValue}
                onChange={setTextValue}
                onSubmit={handleN8nUrlSubmit}
                placeholder="https://your-n8n.example.com"
              />
            </Box>
            {phase.err ? <ErrorLine message={phase.err} /> : null}
            <HintBar hints={['Enter ↵  confirm', 'Ctrl+C  cancel']} />
          </Box>
        );

      // ── N8n reuse API key ───────────────────────────────────────────────
      case 'n8n-reuse-apikey':
        return (
          <Box flexDirection="column">
            <FieldLabel label="n8n API key" />
            <Text dimColor>  A saved key exists for {phase.url}</Text>
            <SelectList
              options={['Keep the saved key', 'Enter a new key'] as const}
              cursor={phase.cursor}
              getLabel={(v) => v}
            />
            <HintBar hints={['↑↓  move', 'Enter ↵  confirm', 'Ctrl+C  cancel']} />
          </Box>
        );

      // ── N8n API key ─────────────────────────────────────────────────────
      case 'n8n-apikey':
        return (
          <Box flexDirection="column">
            <FieldLabel label="n8n API key" />
            <Box marginLeft={2}>
              <TextInput
                value={textValue}
                onChange={setTextValue}
                onSubmit={handleN8nApiKeySubmit(phase.url)}
                mask="●"
                placeholder="your-api-key"
              />
            </Box>
            {phase.err ? <ErrorLine message={phase.err} /> : null}
            <HintBar hints={['Enter ↵  confirm', 'Ctrl+C  cancel']} />
          </Box>
        );

      // ── N8n connecting ──────────────────────────────────────────────────
      case 'n8n-connecting':
        return (
          <Box flexDirection="column">
            <SpinnerDisplay message={`Connecting to ${phase.url}…`} frame={spinnerFrame} />
          </Box>
        );

      // ── N8n project selection ───────────────────────────────────────────
      case 'n8n-project': {
        const projectLabels = phase.projects.map((p) =>
          p.name ?? p.id,
        );
        return (
          <Box flexDirection="column">
            <FieldLabel label="n8n project" />
            <Text dimColor>  {phase.projects.length} project(s) found</Text>
            <SelectList
              options={phase.projects}
              cursor={phase.cursor}
              getLabel={(p) => p.name ?? p.id}
              getHint={(p) => p.id}
            />
            <HintBar hints={['↑↓  move', 'Enter ↵  select', 'Ctrl+C  cancel']} />
          </Box>
        );
      }

      // ── N8n sync folder ─────────────────────────────────────────────────
      case 'n8n-syncfolder':
        return (
          <Box flexDirection="column">
            <FieldLabel label="Local workflow sync folder" />
            <Box marginLeft={2}>
              <TextInput
                value={textValue}
                onChange={setTextValue}
                onSubmit={handleSyncFolderSubmit(phase.url, phase.apiKey, phase.project)}
                placeholder="workflows"
              />
            </Box>
            {phase.err ? <ErrorLine message={phase.err} /> : null}
            <HintBar hints={['Enter ↵  confirm', 'Ctrl+C  cancel']} />
          </Box>
        );

      // ── N8n saving ──────────────────────────────────────────────────────
      case 'n8n-saving':
        return (
          <Box flexDirection="column">
            <SpinnerDisplay message="Saving n8n configuration and refreshing workspace…" frame={spinnerFrame} />
          </Box>
        );

      // ── LLM provider ────────────────────────────────────────────────────
      case 'llm-provider':
        return (
          <Box flexDirection="column">
            <FieldLabel label="Default LLM provider" />
            <SelectList
              options={VALID_PROVIDERS}
              cursor={phase.cursor}
              getLabel={(v) => v}
              getHint={(v) => v === phase.initial ? 'currently configured' : undefined}
            />
            <HintBar hints={['↑↓  move', 'Enter ↵  select', 'Ctrl+C  cancel']} />
          </Box>
        );

      // ── LLM reuse API key ───────────────────────────────────────────────
      case 'llm-reuse-apikey':
        return (
          <Box flexDirection="column">
            <FieldLabel label={`${phase.provider} API key`} />
            <Text dimColor>  A saved key exists for {phase.provider}</Text>
            <SelectList
              options={['Keep the saved key', 'Enter a new key'] as const}
              cursor={phase.cursor}
              getLabel={(v) => v}
            />
            <HintBar hints={['↑↓  move', 'Enter ↵  confirm', 'Ctrl+C  cancel']} />
          </Box>
        );

      // ── LLM API key ─────────────────────────────────────────────────────
      case 'llm-apikey':
        return (
          <Box flexDirection="column">
            <FieldLabel label={`${phase.provider} API key`} />
            <Box marginLeft={2}>
              <TextInput
                value={textValue}
                onChange={setTextValue}
                onSubmit={handleLlmApiKeySubmit(phase.provider)}
                mask="●"
                placeholder="your-api-key"
              />
            </Box>
            {phase.err ? <ErrorLine message={phase.err} /> : null}
            <HintBar hints={['Enter ↵  confirm', 'Ctrl+C  cancel']} />
          </Box>
        );

      // ── LLM models loading ──────────────────────────────────────────────
      case 'llm-models-loading':
        return (
          <Box flexDirection="column">
            <SpinnerDisplay message={`Fetching available models for ${phase.provider}…`} frame={spinnerFrame} />
          </Box>
        );

      // ── LLM model selection ─────────────────────────────────────────────
      case 'llm-model': {
        const modelOptions = [...phase.models.slice(0, 50), '__custom__'];
        return (
          <Box flexDirection="column">
            <FieldLabel label={`Default model  ·  ${phase.provider}`} />
            {phase.models.length === 0 ? (
              <Box marginLeft={2}>
                <TextInput
                  value={textValue}
                  onChange={setTextValue}
                  onSubmit={(v) => {
                    const m = v.trim() || phase.defModel;
                    const needsUrl = llmDef.needsBaseUrl(phase.provider);
                    if (needsUrl || llmDef.getBaseUrl(phase.provider)) {
                      setPhase({ kind: 'llm-baseurl', provider: phase.provider, apiKey: phase.apiKey, model: m, def: llmDef.getBaseUrl(phase.provider) ?? '' });
                      setTextValue(llmDef.getBaseUrl(phase.provider) ?? '');
                    } else {
                      callbacks.saveLlmConfig({ provider: phase.provider, apiKey: phase.apiKey, model: m });
                      setPhase({ kind: 'surfaces', cursor: 0, selected: surfDef.surfaces });
                    }
                  }}
                  placeholder={phase.defModel}
                />
              </Box>
            ) : (
              <SelectList
                options={modelOptions}
                cursor={phase.cursor}
                getLabel={(v) => v === '__custom__' ? '⌨  enter manually…' : v}
                getHint={(v) => v === phase.defModel ? 'recommended' : undefined}
              />
            )}
            <HintBar hints={phase.models.length > 0 ? ['↑↓  move', 'Enter ↵  select', 'Ctrl+C  cancel'] : ['Enter ↵  confirm', 'Ctrl+C  cancel']} />
          </Box>
        );
      }

      // ── LLM base URL ────────────────────────────────────────────────────
      case 'llm-baseurl':
        return (
          <Box flexDirection="column">
            <FieldLabel label={`${phase.provider} base URL`} />
            <Text dimColor>  Leave empty to use the default endpoint</Text>
            <Box marginLeft={2}>
              <TextInput
                value={textValue}
                onChange={setTextValue}
                onSubmit={handleBaseUrlSubmit(phase.provider, phase.apiKey, phase.model)}
                placeholder={phase.def || 'https://api.example.com/v1'}
              />
            </Box>
            {phase.err ? <ErrorLine message={phase.err} /> : null}
            <HintBar hints={['Enter ↵  confirm  (empty = default)', 'Ctrl+C  cancel']} />
          </Box>
        );

      // ── Surfaces selection ──────────────────────────────────────────────
      case 'surfaces':
        return (
          <Box flexDirection="column">
            <FieldLabel label="Optional messaging gateways" />
            <Text dimColor>  These enable Yagr to receive work from external channels</Text>
            <Box marginTop={1}>
              <MultiSelectList
                options={SURFACE_OPTIONS}
                cursor={phase.cursor}
                selected={phase.selected}
              />
            </Box>
            <HintBar hints={['↑↓  move', 'Space  toggle', 'Enter ↵  confirm', 'Ctrl+C  cancel']} />
          </Box>
        );

      // ── Telegram reuse token ────────────────────────────────────────────
      case 'telegram-reuse-token':
        return (
          <Box flexDirection="column">
            <FieldLabel label="Telegram bot token" />
            <Text dimColor>  A saved token is already configured</Text>
            <SelectList
              options={['Keep the saved token', 'Enter a new token'] as const}
              cursor={phase.cursor}
              getLabel={(v) => v}
            />
            <HintBar hints={['↑↓  move', 'Enter ↵  confirm', 'Ctrl+C  cancel']} />
          </Box>
        );

      // ── Telegram token ──────────────────────────────────────────────────
      case 'telegram-token':
        return (
          <Box flexDirection="column">
            <FieldLabel label="Telegram bot token" />
            <Text dimColor>  Create a bot via @BotFather and paste the token here</Text>
            <Box marginLeft={2}>
              <TextInput
                value={textValue}
                onChange={setTextValue}
                onSubmit={handleTelegramTokenSubmit(phase.surfaces)}
                mask="●"
                placeholder="123456789:ABCdef..."
              />
            </Box>
            {phase.err ? <ErrorLine message={phase.err} /> : null}
            <HintBar hints={['Enter ↵  confirm', 'Ctrl+C  cancel']} />
          </Box>
        );

      // ── Telegram connecting ─────────────────────────────────────────────
      case 'telegram-connecting':
        return (
          <Box flexDirection="column">
            <SpinnerDisplay message="Verifying Telegram bot token…" frame={spinnerFrame} />
          </Box>
        );

      // ── Done ────────────────────────────────────────────────────────────
      case 'done':
        return (
          <Box flexDirection="column">
            <Text color="green" bold>{CHECK}  Setup complete</Text>
            <Box marginTop={1} flexDirection="column">
              {phase.n8nHost ? <Text dimColor>  n8n    {DOT}  {phase.n8nHost}</Text> : null}
              {phase.provider ? <Text dimColor>  LLM    {DOT}  {phase.provider}{phase.model ? ` / ${phase.model}` : ''}</Text> : null}
              {phase.surfaces.length > 0
                ? <Text dimColor>  Gates  {DOT}  {phase.surfaces.join(', ')}</Text>
                : <Text dimColor>  Gates  {DOT}  none</Text>}
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Next: </Text><Text color="cyan">yagr start</Text>
            </Box>
          </Box>
        );

      // ── Cancelled ───────────────────────────────────────────────────────
      case 'cancelled':
        return (
          <Box>
            <Text color="yellow">  Setup cancelled.</Text>
          </Box>
        );

      // ── Error ───────────────────────────────────────────────────────────
      case 'error':
        return (
          <Box>
            <Text color="red">  ✕ {phase.message}</Text>
          </Box>
        );
    }
  }
}
