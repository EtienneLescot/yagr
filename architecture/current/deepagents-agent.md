# Agent Architecture — deepagentsjs (LangGraph)

Ce document décrit l'architecture de l'agent Yagr après la migration complète vers deepagentsjs.

## Vue d'ensemble

L'agent Yagr est construit sur **deepagentsjs** (`createDeepAgent`), qui utilise LangGraph comme
moteur d'orchestration. Toutes les gateways consomment un `YagrDeepAgentHandle`.

## Separation Haute Niveau

Le modele d'architecture de reference est le suivant:

1. `yagr-agent` est un agent de codage strictement agnostique.
2. `yagr-manager` fournit une premiere couche d'instructions via le `AGENTS.md` de la home Yagr. Ce fichier est seme depuis le template manager `src/manager-tooling/YAGENTS.md` et indique a l'agent que la home Yagr est sa base operationnelle et que `n8n-workspace` est un sous-workspace dedie aux automatisations.
3. Le `AGENTS.md` genere par `n8nac` constitue la deuxieme couche d'instructions metier pour le travail dans le workspace n8n, mais il est lu par l'agent quand celui-ci entre dans `n8n-workspace`; il n'est pas injecte d'office comme couche de system prompt.
4. En parallele, `yagr-manager` porte sa propre couche infrastructure (n8n local, relay, proxy, setup, tunnel, etc.) sans melanger cette logique avec le coeur de `yagr-agent`.
5. Les comportements manager specifiques passent par des commandes CLI internes (`yagr presentWorkflowResult`, `yagr yagrProxy`) executees via le shell, jamais par injection explicite de tools dans le deep-agent.
6. Le backend deepagents principal est `LocalShellBackend` en mode host-native: les file tools et le shell partagent le meme cwd reel (`YAGR_HOME`) et la meme semantique de chemins.

```mermaid
flowchart TD
    subgraph AgentCore["yagr-agent"]
        YA[Agent de codage<br/>agnostique]
    end

    subgraph ManagerLayer["Second layer of specific instructions: home Yagr"]
        YI[AGENTS.md de la home<br/>seme depuis le template<br/>manager YAGENTS.md<br/>cadre le contexte<br/>et renvoie vers le workspace]
        YC[Commandes CLI manager<br/>utilisees via shell<br/>yagr presentWorkflowResult<br/>yagr yagrProxy]
    end

    subgraph WorkspaceContainer["Second layer of specific instructions: n8n-workspace"]
        NA[AGENT.md / AGENTS.md<br/>genere par n8nac]
        NC[Commandes CLI workspace<br/>utilisees via shell<br/>npx n8nac ...]
    end

    subgraph InfraLayer["Infrastructure yagr-manager"]
        NI[n8n<br/>managed runtime]
        RP[relay<br/>proxies<br/>tunnel<br/>setup]
    end

    YI --> YA
    YA -.inspecte.-> NA
    NA --> NC
    YA --> WorkspaceContainer
    YA --> YC
    YA --> NC
    RP --> YC
    NI --> WorkspaceContainer
```

Contraintes d'architecture:

- `yagr-agent` ne porte aucune regle n8n specifique en dur.
- le `AGENTS.md` de home est la premiere couche effectivement lue par l'agent.
- `src/manager-tooling/YAGENTS.md` est le template source maintenu par `yagr-manager` pour semer ce `AGENTS.md` de home.
- le comportement metier n8n de premier niveau est porte par le `AGENTS.md` genere dans `n8n-workspace`.
- la home Yagr reste la racine operationnelle; `n8n-workspace` est un sous-workspace, pas le cwd implicite du process.
- le backend ne fournit pas de faux root virtuel commun. Les chemins relatifs sont resolus depuis `YAGR_HOME`; les chemins absolus restent les chemins absolus reels du host.
- la couche infrastructure manager reste separee des couches d'instructions exposees a l'agent de codage.

```mermaid
flowchart TD
    subgraph Interfaces
        TUI[TUI / Ink\ninteractive-ui.tsx]
        WEB[WebUI / React\nwebui.ts]
        TG[Telegram\ntelegram.ts]
        CLI[CLI\ncli.ts]
    end

    subgraph Gateway["src/gateway/"]
        LGE[langgraph-events.ts\nadaptateur events]
    end

    subgraph DeepAgent["deepagentsjs"]
        DA[createDeepAgent]
        CKPT[LangGraph Checkpointer\nthread_id = sessionId]
    end

    subgraph YagrTools["src/tools/"]
        GT[httpRequest · execute · reportProgress\nrequestRequiredAction]
    end

    subgraph ManagerCli["src/manager-tooling/"]
        MT[presentWorkflowResult\nyagrProxy\ncommandes CLI internes]
    end

    subgraph Prompt["src/prompt/"]
        BSP[build-system-prompt.ts]
    end

    subgraph Memory["src/memory/"]
        MS[MemoryStore\nmemories cross-session]
    end

    subgraph Engine["src/engine/"]
        N8N[N8nEngine\nEngineRuntimePort]
    end

    Interfaces --> LGE
    LGE --> DA
    DA --> CKPT
    DA --> YagrTools
    DA --> BSP
    BSP --> MS
    YagrTools --> MT
    MT --> N8N
```

## Point d'entrée : `createYagrDeepAgent`

```typescript
// src/agent-factory.ts
export async function createYagrDeepAgent(
  engine: EngineRuntimePort,
  configService: YagrConfigStoreLike,
): Promise<YagrDeepAgentHandle>
```

Responsabilités :
1. Instancie un `BaseChatModel` LangChain via `createLangChainModel(configService)`
2. Construit le `systemPrompt` via `buildSystemPrompt(engine, configService, ...)`
3. Assemble les tools LangChain agnostiques (`src/tools/langchain/*`)
4. Configure un `MemorySaver` (checkpointer en mémoire, par thread)
5. Instancie `LocalShellBackend({ rootDir: getYagrHomeDir(), virtualMode: false, inheritEnv: true })`
6. Appelle `createDeepAgent({ model, tools, systemPrompt, checkpointer, backend })`

Clarification importante:

- `yagr-agent` reste agnostique et ne porte pas de connaissance n8n specifique dans son system prompt ou dans sa factory de tools
- `yagr-manager` n'injecte pas de tools manager dans le deep-agent
- le `AGENTS.md` de home apprend a l'agent a utiliser les commandes CLI internes `yagr presentWorkflowResult` et `yagr yagrProxy` via le shell
- les instructions shell `n8nac` de premier niveau proviennent du `AGENTS.md` genere par `n8nac` dans `n8n-workspace`, que l'agent lit lorsqu'il entre dans ce sous-workspace
- `src/manager-tooling/YAGENTS.md` ne doit pas dupliquer ces instructions; il ne porte que les comportements specifiques a yagr-manager
- les instructions doivent parler en chemins relatifs a la home Yagr (`n8n-workspace/...`, `./n8n-workspace/...`) et non en faux chemins absolus de type `/n8n-workspace/...`

## Contrat backend

Le backend principal actuel est `LocalShellBackend` de deepagents en mode local host-native.

Implications:

- le cwd shell et la base des chemins relatifs pointent tous deux vers `YAGR_HOME`
- les outils fichier et `execute` doivent partager la meme semantique de chemins pour eviter les divergences de comportement
- `virtualMode` ne doit pas etre active dans ce mode, car deepagents documente explicitement qu'il ne virtualise que les operations filesystem et pas le shell
- si un jour Yagr a besoin d'un vrai root virtuel commun aux file tools et a `execute`, il faudra utiliser un vrai backend sandbox de deepagents, pas `LocalShellBackend`

## Persistance de session

- **Historique de conversation** : `MemorySaver` (LangGraph, in-memory, par thread). Le `thread_id` est le `sessionId` de la gateway.
- **Métadonnées UI** (titre, timestamps, display messages) : `WebUiSessionRegistry` dans `src/session/webui-sessions.ts` — fichiers JSON dans `YAGR_HOME/sessions/`.

`session-store.ts` (`SessionStore`) a été supprimé. Le checkpointer LangGraph est le SSOT pour l'historique de conversation.

## Adaptateur events : `langgraph-events.ts`

Traduit les events LangGraph en `YagrUserVisibleUpdate` (interface stable côté gateways) :

| Event LangGraph | Event Yagr équivalent |
|---|---|
| `on_chain_start` (node `agent`) | `YagrPhaseEvent { phase: 'inspect', status: 'started' }` |
| `on_tool_start` | `YagrToolEvent { status: 'started', toolName }` |
| `on_tool_end` | `YagrToolEvent { status: 'completed', toolName }` |
| `on_chat_model_stream` | streaming texte assistant |
| interrupt (HITL) | `YagrStateEvent { state: 'waiting_for_permission' }` |

## Couche LLM

### Couche A — Agent deepagentsjs (LangChain)

`src/llm/create-langchain-model.ts` : factory `BaseChatModel` LangChain.

Providers supportés :
| Provider | Classe LangChain | Auth |
|---|---|---|
| `anthropic` | `ChatAnthropic` | API key / env |
| `openai` | `ChatOpenAI` | API key / env |
| `google` | `ChatGoogleGenerativeAI` | API key / env |
| `mistral` | `ChatMistralAI` | API key / env |
| `openrouter` | `ChatOpenAI` (baseURL custom) | API key |
| `anthropic-proxy` | `ChatAnthropic` | `getAnthropicAccountSession()` |
| `openai-proxy` | `ChatOpenAI` | `getOpenAiAccountSession()` |
| `copilot-proxy` | `ChatOpenAI` (baseURL Copilot) | `resolveCopilotApiToken()` |

Les fonctions de résolution (`resolveLanguageModelConfig`, `resolveModelProvider`, `resolveModelName`) vivent dans ce même fichier.

### Couche B — Relay LLM pour n8n (Vercel AI SDK)

`proxy-runtime.ts` + `llm-relay-server.ts` exposent un endpoint OpenAI-compatible local que les noeuds `lmChatOpenAi` n8n peuvent cibler. Cette couche est **orthogonale** à deepagentsjs et conservée identique.

## Modules supprimés

| Module | Remplacé par |
|---|---|
| `src/agent.ts` (`YagrSessionAgent`) | `src/agent-factory.ts` + deepagentsjs |
| `src/runtime/run-engine.ts` | LangGraph (deepagentsjs) |
| `src/runtime/tool-runtime-strategy.ts` | Supprimé — deepagentsjs ne segmente pas par capacité |
| `src/runtime/context-compaction.ts` | deepagentsjs (auto-compaction native) |
| `src/runtime/policy-hooks.ts` | Supprimé |
| `src/runtime/completion-gate.ts` | Supprimé |
| `src/runtime/required-actions.ts` | Supprimé |
| `src/runtime/outcome.ts` | Supprimé |
| `src/llm/create-language-model.ts` | `create-langchain-model.ts` |
| `src/session/session-store.ts` | `src/session/webui-sessions.ts` + LangGraph checkpointer |

## Points de vigilance

### `requestRequiredAction` — outil Yagr spécifique

Conservé comme tool injecté dans deepagentsjs. La sémantique `blocking` vs `follow-up` est une convention produit Yagr. Ne pas mapper sur `interruptOn` de LangGraph (sémantique différente).

### `src/runtime/user-visible-updates.ts`

Conservé (utilisé par `langgraph-events.ts` et `telegram.ts`). Ce fichier est l'interface stable des events visibles par les gateways.

### Mémoire cross-session (`src/memory/`)

`MemoryStore` est conservé. Il répond à un besoin distinct du checkpointer : construire un contexte long-terme *synthétique* entre sessions (résumés injectés dans le system prompt via `loadRecentMemory()`). Pas de duplication avec `MemorySaver`.
