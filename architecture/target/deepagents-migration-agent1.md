# Migration vers deepagentsjs — Spec de migration

> Document d'architecture cible pour le remplacement de la couche agentique Yagr
> par `deepagentsjs` (LangChain/LangGraph).
>
> Statut : document de référence consolidé

---

## 0. Contexte et motivation

Yagr a été refactorisé pour rendre son agent **agnostique** du backend
d'automation (Engine Port). Dans ce contexte, la couche runtime interne
(`src/runtime/`, `src/agent.ts`, `src/llm/`) représente une surface de
maintenance significative alors que des solutions tiers matures existent.

`deepagentsjs` (TypeScript, MIT, LangChain) implémente exactement le pattern
"agent harness" : boucle agentique complète, planification, sous-agents,
gestion de contexte — sans imposer d'UI ni de backend métier.

**Principe directeur de cette migration** : deepagentsjs est le **backend agentique**. Les façades Yagr (WebUI, TUI, Telegram, CLI) le consomment. Yagr se concentre sur ce qui lui est propre — façades, infrastructure n8n, relay LLM, mémoire cross-session et tooling métier.

---

## 1. Vue d'ensemble : ce qui change, ce qui reste

```mermaid
flowchart TD
    subgraph RESTE["Yagr — périmètre conservé"]
        GW[Gateways\nWebUI · Telegram · TUI · CLI]
        MEM[Memory Store\nrésumés cross-session]
        SETUP[Setup / Onboarding\nn8n-local · tunnel · config]
        RELAY[Relay LLM n8n\nOpenAI-compatible endpoint\nlocalhost:11437]
        MT[Manager Tooling\npresentWorkflowResult · yagrProxy]
        ENGINE[Engine Ports\nN8nEngine · YagrNativeEngine stub]
        N8NAC[n8nac\ndépendance externe]
        ACC[Account runtimes\nCopilot Device Flow · Anthropic Setup Token\nOpenAI OAuth · API keys]
    end

    subgraph REMPLACE["deepagentsjs — périmètre délégué"]
        DA[createDeepAgent]
        TODO[TodoListMiddleware]
        FS[FilesystemMiddleware]
        SUB[SubAgentMiddleware]
        LOOP[Boucle LangGraph\nstreaming natif]
        CTX[Context management\nauto-summarization]
    end

    GW --> DA
    DA -->|tools injectés| MT
    MT --> ENGINE
    ENGINE --> N8NAC
    DA -->|BaseChatModel LangChain| ACC
    MEM --> GW
    SETUP -.->|configure| RELAY
    SETUP -.->|configure| ENGINE
```

---

## 2. Ce qui est supprimé de Yagr

Ces modules sont **entièrement remplacés** par deepagentsjs et ses
middlewares. Ils ne disparaissent pas du codebase en une seule passe —
la migration se fait module par module — mais leur suppression est
l'objectif final.

### 2.1 `src/runtime/`

| Fichier actuel | Rôle | Remplacé par |
|---|---|---|
| `run-engine.ts` | Boucle principale, streaming, phases, recovery | Boucle LangGraph de `createDeepAgent` |
| `tool-runtime-strategy.ts` | Stratégie runtime selon capacité modèle | Supprimé (voir section 5.1 sur les modèles faibles) |
| `context-compaction.ts` | Résumé automatique quand le contexte déborde | `auto-summarization` natif deepagentsjs |
| `completion-gate.ts` | Enforcement de fin de run structurée | Logique LangGraph + prompt système |
| `policy-hooks.ts` | Hooks pré/post tool, politiques runtime | `middleware` deepagentsjs |
| `required-actions.ts` | Représentation structurée des blockers | Outil `requestRequiredAction` conservé, injecté comme tool custom |
| `outcome.ts` | Analyse de l'issue du run | Supprimé |
| `user-visible-updates.ts` | Mapping events → updates UI | **Conservé et adapté** pour mapper les events LangGraph (voir section 4) |

### 2.2 `src/agent.ts`

`YagrSessionAgent` est **remplacé** par `createDeepAgent`. Les
responsabilités qu'il portait sont redistribuées :

| Responsabilité actuelle | Destination |
|---|---|
| Historique `CoreMessage[]` + registre sessions | LangGraph checkpointer + thread metadata (titre, date, compteur) |
| `run(prompt, options)` | `agent.stream({ messages })` LangGraph |
| `compactHistory()` | Auto-summarization deepagentsjs |
| `clearConversation()` | Reset du thread LangGraph |
| Invalidation de session sur changement d'instructions | Hook `onSessionInvalidated` dans l'adaptateur Gateway (voir section 4.3) |
| `buildSystemPromptSnapshot()` | `systemPrompt` passé à `createDeepAgent` — reconstruit au démarrage de chaque session |

### 2.3 `src/llm/`

La couche LLM Yagr est **restructurée**, pas supprimée en bloc. Voir
section 5.3 pour la distinction complète des trois couches LLM.

| Module | Sort |
|---|---|
| `create-language-model.ts` | **Adapté** — output devient `BaseChatModel` LangChain au lieu de Vercel AI SDK model |
| `provider-plugin.ts` | Conservé — alimente la factory LangChain et le relay n8n |
| `provider-registry.ts` | Conservé |
| `provider-discovery.ts` | Conservé |
| `provider-metadata.ts` | Conservé |
| `capability-resolver.ts` | **Supprimé** (deepagentsjs ne segmente pas par capacité) |
| `model-capabilities.ts` | **Supprimé** |
| `proxy-runtime.ts` | **Conservé** — sert uniquement les nœuds LLM n8n (voir section 5.3) |
| `llm-relay-server.ts` | **Conservé** — sert uniquement les nœuds LLM n8n |
| `anthropic-relay.ts` | **Conservé** — traduction OpenAI → Anthropic pour le relay n8n |
| `*-account.ts` | **Conservés intégralement** — auth OAuth, Device Flow, Setup Token (voir section 5.3) |

---

## 3. Ce qui reste entièrement dans Yagr

### 3.1 `src/setup/` et `src/setup.ts` — Inchangé

L'onboarding, le wizard de configuration, `application-services.ts`,
`status.ts` — rien ne change. Le setup configure le proxy LLM et les
Engine Ports exactement comme aujourd'hui.

### 3.2 `src/n8n-local/` — Inchangé

Bootstrap n8n local (Docker / direct), `managed-runtime.ts`,
`docker-manager.ts`, `direct-manager.ts`, `owner-credentials.ts`,
`browser-auth.ts`, `state.ts`, `n8n-tunnel.ts` (Cloudflare Tunnel) —
aucun impact. Ce bloc est totalement découplé de la boucle agentique.

### 3.3 `src/config/` — Inchangé

`YagrConfigService`, `YagrN8nConfigService`, `yagr-home.ts`,
`load-n8n-engine-config.ts`, `local-state.ts` — aucun impact.

### 3.4 `src/engine/` — Inchangé

Les Engine Ports (`EngineRuntimePort`, `NodeCatalogPort`,
`WorkflowLifecyclePort`, etc.), `N8nEngine`, et le stub
`YagrNativeEngine` restent identiques. La migration deepagentsjs
n'accélère ni ne ralentit la livraison de `YagrNativeEngine` — les deux
sont indépendants.

### 3.5 `src/manager-tooling/` — Inchangé, réinjecté

`presentWorkflowResult`, `yagrProxy`, `YAGENTS.md` restent dans Yagr.
Ils sont passés à `createDeepAgent` comme tools custom :

```typescript
const agent = createDeepAgent({
  model: new ChatOpenAI({ baseURL: yagrProxyBaseUrl }),
  tools: [
    presentWorkflowResultTool,
    yagrProxyTool,
    requestRequiredActionTool,
    // ... outils FS/shell non couverts nativement par deepagentsjs
  ],
  systemPrompt: buildSystemPrompt(engine),
});
```

Les tools génériques déjà couverts par deepagentsjs (`readFile`,
`writeFile`, `grep`, `listDir`, `glob`) peuvent être **supprimés de
`src/tools/`** puisqu'ils sont fournis nativement par
`FilesystemMiddleware`. Ceux propres à Yagr (`httpRequest`, `runScript`,
`runShell`, `requestRequiredAction`) restent injectés.

### 3.6 `src/prompt/build-system-prompt.ts` — Conservé, adapté

La construction du system prompt reste dans Yagr :

- inject contexte engine (`engine.name`)
- inject `n8nHost`, tunnel URL, `workflowDir`
- inject `MANAGER_INSTRUCTIONS`, `YAGENTS.md`, home instructions, workspace instructions
- inject mémoire des sessions récentes

Ce prompt est passé à `createDeepAgent({ systemPrompt })`. Il est
reconstruit à chaque nouvelle session (même comportement qu'aujourd'hui).

L'invalidation de session sur changement d'instructions workspace (logique
actuelle dans `YagrSessionAgent.run`) devient un hook dans l'adaptateur
Gateway (voir section 4.3).

### 3.7 `src/session/` — **Supprimé**

`SessionStore` et `session-types.ts` sont **supprimés**. Le LangGraph checkpointer devient l'unique source de vérité pour les sessions.

Le `thread_id` LangGraph est l'identifiant de session. Les métadonnées nécessaires aux façades (titre, `updatedAt`, `messageCount`) sont stockées dans le **thread metadata** du checkpointer — un dictionnaire arbitraire attaché à chaque thread, écrit par le backend Yagr à la fin de chaque run.

**Toutes les façades** (WebUI sidebar, TUI `--list-sessions`, Telegram historique) lisent la liste des sessions en interrogeant le checkpointer LangGraph, pas un store local.

```
LangGraph Checkpointer
──────────────────────────────────────────────
thread_id           → identifiant de session
thread.metadata     → { title, updatedAt, messageCount }
thread.checkpoint   → état du graphe (messages, variables)
```

`session-types.ts` est conservé uniquement pour ses types partagés avec les façades (`SerializedChatMessage`, etc.) jusqu'à ce qu'ils soient remplacés par les types LangGraph.

### 3.8 `src/memory/` — Conservé, migration future possible

`MemoryStore` et `memory-types.ts` restent. La mémoire cross-session
(résumés de sessions passées) est injectée dans le system prompt via
`loadRecentMemory()` dans `build-system-prompt.ts`.

Contrairement à `SessionStore` (supprimé, remplacé par le checkpointer),
`MemoryStore` répond à un besoin distinct : construire un contexte
long-terme *synthétique* entre sessions, pas stocker l'état brut d'un
thread. Il n'y a pas de duplication avec le checkpointer.

LangGraph Store (long-term memory native) est une évolution possible qui
unifierait la persistance. C'est hors scope de cette migration.

---

## 4. Adaptation des Gateways

C'est **le principal travail de migration côté Yagr**. Chaque gateway
consomme aujourd'hui des events Yagr typés (`YagrPhaseEvent`,
`YagrStateEvent`, `YagrToolEvent`). Ces events viennent de `run-engine.ts`.
Après migration, ils viennent du streaming LangGraph.

### 4.1 Mapping events LangGraph → YagrUserVisibleUpdate

`user-visible-updates.ts` est **conservé comme interface stable** côté
gateways. Un adaptateur traduit les events LangGraph en cette interface :

| Event LangGraph | Event Yagr équivalent |
|---|---|
| `on_chain_start` (node `agent`) | `YagrPhaseEvent { phase: 'inspect', status: 'started' }` |
| `on_tool_start` | `YagrToolEvent { status: 'started', toolName }` |
| `on_tool_end` | `YagrToolEvent { status: 'completed', toolName }` |
| `on_chat_model_stream` | streaming texte assistant |
| `write_todos` tool call | nouveau event `YagrPhaseEvent { phase: 'plan' }` |
| interrupt (HITL) | `YagrStateEvent { state: 'waiting_for_permission' }` |

Cet adaptateur vit dans un nouveau fichier `src/gateway/langgraph-events.ts`.

### 4.2 WebUI Gateway (`src/gateway/webui.ts`)

Changements ciblés :

- **Session bootstrap** : à la réception d'un message, si `sessionId` est
  connu → charger `PersistedSession` → recharger l'historique dans le
  thread LangGraph via `checkpointer`.
- **Streaming SSE** : remplacer la consommation des events `YagrRunEngine`
  par `agent.streamEvents(...)` LangGraph, passé dans l'adaptateur ci-dessus.
- **Session persistence** : à la fin de chaque run, écrire les métadonnées de session (titre, `updatedAt`, `messageCount`) dans le thread metadata LangGraph.
- **Extraction de mémoire** : `extractSessionMemory` reste appelé
  post-run, identique.
- **`YagrSessionAgent`** supprimé des imports.

API HTTP inchangée côté client React. Les types `WebUiChatStreamEvent`
restent stables — seul le producteur change.

### 4.3 Telegram Gateway (`src/gateway/telegram.ts`)

Changements ciblés :

- **Session par chat** : le `chatId` Telegram est le `thread_id` LangGraph.
  La continuité de conversation est automatique si le checkpointer est
  persistant (ou en mémoire par process).
- **Streaming** : Telegram ne supporte pas le streaming natif. Le gateway
  collecte la réponse finale via `agent.invoke(...)` comme aujourd'hui,
  ou utilise `streamEvents` pour les progress updates intermédiaires.
- **Required actions** : le tool `requestRequiredAction` injecté dans
  deepagentsjs émet un event capté par le gateway pour envoyer un message
  bloquant à l'utilisateur Telegram.
- **Invalidation de session** : si le system prompt change entre deux runs
  (détecté par fingerprint sur `workspaceInstructions`), réinitialiser
  le thread LangGraph pour ce `chatId`.

### 4.4 TUI Gateway (`src/gateway/interactive-ui.tsx`)

Changements ciblés :

- Remplacer la consommation de `YagrRunEngine.execute(...)` par
  `agent.streamEvents(...)` avec l'adaptateur LangGraph → `YagrUserVisibleUpdate`.
- Les lanes de la TUI (Narrative / Action / Result / Interrupt) restent
  le modèle UX — elles sont alimentées par les events mappés, pas par
  les phases internes.
- Le todo-list visible (`write_todos`) peut être rendu comme une nouvelle
  lane "Plan" dans la TUI si souhaité.

### 4.5 CLI Gateway (`src/gateway/cli.ts`)

Usage non-interactif. `agent.invoke(...)` suffit. Aucun streaming nécessaire.
Changement minimal.

---

## 5. Points de vigilance

### 5.1 Modèles faibles (sans tool calling natif) — code vestigial

Le mode `capability: 'none'` dans `tool-runtime-strategy.ts` est du code
**vestigial**. Il n'a jamais été un path fonctionnel de bout en bout :

- Les directives JSON (`{"tool":"writeFile",...}`) demandent au modèle
  d'émettre des objets structurés à la place d'appels d'outils.
- Mais `run-engine.ts` ne parse et n'exécute jamais ces JSON — il se
  contente de limiter les steps à 1.
- Le seul test couvrant ce mode utilise `text-embedding-3-small`
  (un modèle d'embedding, pas un modèle de chat).

**Conclusion** : ce path n'est pas à préserver dans la migration. Il est
supprimé avec `tool-runtime-strategy.ts` sans dette fonctionnelle.

### 5.2 `requestRequiredAction` — outil Yagr spécifique

Ce tool est central dans la doctrine Yagr (blockers structurés,
distinction `blocking` vs `follow-up`). deepagentsjs supporte `interruptOn`
(HITL natif LangGraph) mais la sémantique est différente (approbation
d'outil vs blocage ouvert).

**Recommandation** : conserver `requestRequiredAction` comme tool Yagr
injecté dans deepagentsjs. Ne pas le mapper sur `interruptOn`. C'est une
convention produit, pas un mécanisme d'orchestration.

### 5.3 Trois couches LLM — ne pas confondre

La couche LLM de Yagr couvre trois périmètres distincts qui n'ont pas le
même sort dans la migration.

#### Couche A — Façades agent autonome

WebUI / Telegram / TUI / CLI. Aucun LLM ici — c'est la couche I/O.
Totalement indépendante du choix deepagentsjs. Aucun impact.

#### Couche B — Relay LLM pour les nœuds n8n

**Fichiers** : `llm-relay-server.ts`, `proxy-runtime.ts`, `anthropic-relay.ts`

Expose un endpoint OpenAI-compatible local (`localhost:11437`) que les nœuds
`lmChatOpenAi` dans n8n pointent. Avantage produit fort : l'utilisateur
configure son LLM une fois dans Yagr et n8n l'utilise automatiquement.

**Sort** : **Conservé identique**. Orthogonal à deepagentsjs. LiteLLM /
AgentGateway sont hors scope — solutions Python infrastructure, sur-ingénierie
pour un CLI local.

#### Couche C — Providers LLM pour l'agent deepagentsjs

C'est la couche restructurée par la migration.

**Ce que LangChain couvre nativement** : API key standard pour tous les
providers majeurs (`@langchain/anthropic`, `@langchain/openai`,
`@langchain/google-genai`). Suffisant pour le cas standard.

**Ce que LangChain ne couvre pas** — les flux auth officiels permettant
aux utilisateurs de consommer leurs abonnements sans clé API de facturation :

| Flux | Provider | Fichier actuel |
|---|---|---|
| GitHub Device Flow | GitHub Copilot | `copilot-account.ts` |
| OAuth Authorization Code | OpenAI Codex | `openai-account.ts` |
| Claude Setup Token | Claude Pro / Max plans | `anthropic-account.ts` |

Ces trois flux restent dans Yagr intégralement. LiteLLM n'aide pas —
c'est un proxy de routage, pas un gestionnaire d'auth OAuth.

**Changement ciblé** : uniquement la factory dans `create-language-model.ts`
— elle passe de l'instanciation d'un modèle Vercel AI SDK à un
`BaseChatModel` LangChain, avec les mêmes credentials résolues par les
`*-account.ts`.

```typescript
// Avant
return anthropic(resolvedModel);  // Vercel AI SDK

// Après
return new ChatAnthropic({ apiKey, model: resolvedModel });  // LangChain
```

Toute la logique d'auth, de token refresh et de discovery reste intacte
dans `*-account.ts`. Seul le format de sortie de la factory change.

### 5.4 `YagrNativeEngine` — indépendance confirmée

La migration vers deepagentsjs est **orthogonale** à la livraison de
`YagrNativeEngine`. Les deux peuvent avancer en parallèle. La migration
deepagentsjs ne débloque pas V2 mais ne le bloque pas non plus.

---

## 6. `src/index.ts` après migration

Les exports publics impactés :

**Supprimés** :
- `YagrSessionAgent`
- `YagrRunEngine`
- `resolveToolRuntimeStrategy`
- `createLanguageModel`, `resolveLanguageModelConfig`, `resolveModelName`
- `filterFunctionToolsForCapability`, `getProviderOptionsForCapability`, etc.
- `buildTools` (remplacé par injection directe dans `createDeepAgent`)
- Types : `YagrToolRuntimeStrategy`, `YagrExecutionMode`, `YagrModelCapabilityProfile`, `YagrToolCallingCapability`, `YagrToolHookContext`, `YagrToolHookDecision`, `YagrCompletionAttempt`, `YagrCompletionHookDecision`, `YagrRuntimeHook`, `YagrRunPhase`, `YagrRunStep`, `YagrPhaseEvent`

**Conservés** :
- Tout ce qui concerne `Engine`, gateways, setup, config, sessions, mémoire
- `buildSystemPrompt`
- Tools unitaires exportés (pour usage externe éventuel)
- `YagrRunResult`, `YagrRequiredAction`, `YagrRunOptions`, `YagrAgentState`

---

## 7. Ordre de migration recommandé

```
Étape 1 — Proxy LLM ready
  Vérifier que llm-relay-server expose un endpoint compatible OpenAI
  Tester ChatOpenAI({ baseURL: proxyUrl }) → appel réel passant par proxy

Étape 2 — Premier createDeepAgent smoke test
  Créer un script de test isolé : createDeepAgent + quelques tools custom
  Valider streaming LangGraph → console

Étape 3 — Adaptateur events LangGraph → YagrUserVisibleUpdate
  Créer src/gateway/langgraph-events.ts
  Couvrir par tests unitaires (mock eventStream → updates attendus)

Étape 4 — Migration WebUI Gateway
  Remplacer YagrSessionAgent par agent.streamEvents dans webui.ts
  Valider session persistence + streaming SSE inchangé côté client

Étape 5 — Migration Telegram Gateway
  Remplacer YagrSessionAgent par agent.invoke dans telegram.ts
  Valider required actions + continuité de conversation par chatId

Étape 6 — Migration TUI / CLI
  Plus simples, pas de session persistence complexe

Étape 7 — Suppression src/runtime/ et src/agent.ts
  Après validation end-to-end sur toutes les gateways

Étape 8 — Nettoyage src/llm/
  Supprimer capability-resolver, model-capabilities, create-language-model
  Ne conserver que proxy-runtime, *-account, provider-registry (pour proxy)
```

---

## 8. Architecture finale — schéma complet

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
        FMT[format-message.ts]
        HV[history-viewport.ts]
        MW[n8n-workflow-middleware.ts]
        MGR[manager.ts\nGatewaySupervisor]
    end

    subgraph Sessions["src/memory/"]
        MS[MemoryStore\ndisque YAGR_HOME/memories/]
    end

    subgraph DeepAgent["deepagentsjs"]
        DA[createDeepAgent]
        TODO[TodoListMiddleware\nwrite_todos]
        FS_MW[FilesystemMiddleware\nread_file write_file grep...]
        SUB[SubAgentMiddleware\ntask]
        CKPT[LangGraph Checkpointer\nthread par session]
    end

    subgraph YagrTools["src/manager-tooling/ + src/tools/"]
        MT[presentWorkflowResult\nyagrProxy\nrequestRequiredAction]
        GT[httpRequest · runScript · runShell]
    end

    subgraph Prompt["src/prompt/"]
        BSP[build-system-prompt.ts\nengine · tunnel · n8nHost\nworkflowDir · memory · YAGENTS.md]
    end

    subgraph Engine["src/engine/"]
        EP[EngineRuntimePort]
        N8N[N8nEngine]
        YENG[YagrNativeEngine stub V2]
    end

    subgraph Infra["src/n8n-local/ + src/setup/"]
        N8NLOCAL[n8n-local\nbootstrap · tunnel · docker · direct]
        SETUP[setup/\nonboarding · application-services · status]
    end

    subgraph Proxy["src/llm/ résiduel"]
        PX[proxy-runtime.ts\nllm-relay-server.ts]
        ACC[account runtimes\nCopilot · Anthropic · OpenAI · local]
    end

    subgraph Config["src/config/"]
        CFG[YagrConfigService\nYagrN8nConfigService\nyagr-home · local-state]
    end

    subgraph N8NAC["dépendances externes"]
        NAC[n8nac\n@n8n-as-code/skills\n@n8n-as-code/transformer]
    end

    Interfaces --> Gateway
    Gateway --> LGE
    LGE --> DA
    DA --> TODO
    DA --> FS_MW
    DA --> SUB
    DA --> CKPT
    DA -->|tools injectés| YagrTools
    DA -->|systemPrompt| BSP
    BSP --> MS
    BSP --> CFG
    YagrTools --> Engine
    Engine --> NAC
    N8N --> Engine
    YENG --> Engine
    DA -->|ChatOpenAI baseURL| PX
    PX --> ACC
    Gateway --> Sessions
    Infra --> CFG
    SETUP --> PX
    SETUP --> Engine
    SETUP --> N8NLOCAL
```

---

## 9. Risques et mitigations

| Risque | Impact | Mitigation |
|---|---|---|
| Deep Agents ne supporte pas le streaming | Haut | Tester en amont (Étape 2 smoke test), fallback sur Vercel AI temporairement |
| Incompatibilité des outils Yagr avec LangChain | Moyen | Envelopper progressivement, tester un par un (Étape 3) |
| Perte de qualité de réponse après migration | Haut | Comparer les résultats avant/apres sur des scénarios identiques |
| Complexité du checkpointing LangGraph | Moyen | Commencer par un checkpointer en mémoire, passer au persistant ensuite |
| Couplage fort avec LangChain | Moyen | Isoler l'intégration dans `langgraph-events.ts`, garder une interface stable |
| Modèles faibles sans tool calling (5.1) | Aucun | Code vestigial jamais fonctionnel — supprimé sans dette |
| `requestRequiredAction` vs `interruptOn` (5.2) | Moyen | Conserver comme tool custom injecté, ne pas mapper sur HITL natif |

---

## 11. Évolution des interfaces UI

Cette section recense les modifications nécessaires sur la TUI (`interactive-ui.tsx`) et la WebUI (`app.tsx` / `store.ts`) pour exposer les capacités nouvelles apportées par deepagentsjs : planification dynamique (`write_todos`), continuité de session par checkpoint, compactage de contexte natif, sous-agents, et interruption HITL.

Le principe directeur est de **ne pas remplacer les abstractions existantes** — les lanes de la TUI, les `ChatMessage` de la WebUI, le `ChatProgressEntry` — mais de les alimenter avec de nouveaux événements issus du bridge `langgraph-events.ts`. Ce qui existe déjà et n'a besoin que d'un nouveau câblage est distingué de ce qui représente un travail UI nouveau.

---

### 11.1 Inventaire des slots UI existants

#### TUI (`interactive-ui.tsx`)

Les abstractions actuelles couvrent déjà un large spectre de cas :

| Élément existant | Utilisé pour | Potentiel nouveau usage |
|---|---|---|
| Lane `narrative` | Réflexion interne, phases | Pensée des sous-agents |
| Lane `action` | Commandes shell | Outil `task` (sub-agent) |
| Lane `result` | Résultats d'outils | Résumé compaction, résultat sub-agent |
| Lane `interrupt` | `required_actions` | HITL LangGraph (`waiting_for_permission`) |
| State `compacting` | Déjà câblé | Rewire vers event LangGraph |
| State `waiting_for_permission` | Déjà câblé | HITL `interruptOn` natif |
| State `resumable` | Déjà câblé | Résumé après checkpoint restore |
| Phase dots (inspect/plan/edit/summarize) | Barre de progression | Rewire vers `on_chain_start` LangGraph |
| `contextFillPercent` bar | Jaugeage du contexte | Rewire vers `context-usage` event |

**Conclusion TUI** : tous les états d'affichage nécessaires existent déjà. Le travail se limite à :
1. Rewirer les événements sources (depuis l'adaptateur `langgraph-events.ts` au lieu de `run-engine.ts`).
2. Ajouter un affichage du plan `write_todos` (nouveau, voir §11.2).
3. Ajouter un affichage de la délégation sub-agent (nouveau, voir §11.2).

#### WebUI (`app.tsx` + `store.ts`)

| Élément existant | Potentiel nouveau usage |
|---|---|
| `sessionHistory` + `SessionSidebar` | Déjà utilisé — enrichi avec nb de checkpoints |
| `switchSession` / `browseSession` / `returnToActiveSession` | Rewire sur `thread_id` LangGraph pour vraie reprise par checkpoint |
| `contextFillPercent` + bouton "Compact" | Rewire vers `context-usage` LangGraph + déclenchement programmatique |
| `ChatProgressEntry` (tone: info/success/error) | Délégation sub-agent, todo updates |
| Phase badge sur `ChatMessage` | Write_todos phase label |
| `busyLabel` dans `WebUiState` | Phase LangGraph courante |
| Streaming `ChatStreamEvent` | Type union à étendre (voir §11.3) |

---

### 11.2 Nouvelles capacités à rendre visibles

#### A. Plans `write_todos` (TodoListMiddleware)

**Ce que deepagentsjs apporte** : chaque appel à `write_todos` publie une liste de tâches (texte libre + statut `pending`/`done`/`in_progress`). Cela matérialise la planification de l'agent avant exécution.

**TUI** :
- Ajouter une fonction `renderTodoList` qui pousse une entrée dans la lane `narrative` avec titre "Plan" et le contenu de la liste (items avec préfixe `☐` / `☑`).
- Chaque mise à jour `write_todos` écrase le dernier todo-entry dans le feed (comparaison par ID).
- Optionnel : un panneau latéral dédié `<TodoPanel>` si l'espace terminal le permet.

**WebUI** :
- Ajouter un `ChatProgressEntry` de type `info` à chaque appel `write_todos`, affiché dans le `progressTicker` du message assistant en cours.
- Alternatively : un composant `<TodoCard>` embarqué dans le message, montrant les items avec cases à cocher visuelles, mis à jour par `patchMessage`.
- **Recommandation** : commencer par `ChatProgressEntry` (changement minimal), évoluer vers `TodoCard` dans une itération suivante.

**Nouveau `ChatStreamEvent`** à ajouter dans le type union de `app.tsx` :
```typescript
| { type: 'todos'; items: Array<{ text: string; status: 'pending' | 'in_progress' | 'done' }> }
```

**Nouveau `WebUiState`** : ajouter `currentTodos: TodoItem[]` dans le store pour maintenir la liste courante séparément des messages, permettant un affichage persistant.

---

#### B. Délégation à des sous-agents (SubAgentMiddleware)

**Ce que deepagentsjs apporte** : le tool `task` lance un sous-agent avec son propre contexte. La durée peut être longue.

**TUI** :
- Mapper `task` tool call sur une entrée lane `action`, titre "Sub-task" avec le texte de la délégation.
- Mapper le retour du sous-agent sur lane `result`, titre "Sub-task completed".
- Pendant l'exécution : state `running` avec `activeOperationText` = texte de la tâche déléguée.

**WebUI** :
- Deux `ChatProgressEntry` : une `info` au démarrage ("Delegating: [description]"), une `success` à la fin.
- Si le sous-agent produit lui-même de la sortie streamée, l'afficher dans un bloc `<details>` rétractable à l'intérieur du message — cette UI est nouvelle.

**Nouveau `ChatStreamEvent`** :
```typescript
| { type: 'sub-agent-start'; description: string }
| { type: 'sub-agent-end'; summary: string }
```

---

#### C. Sessions et reprise par checkpoint LangGraph

**Ce que deepagentsjs apporte** : chaque session est un `thread_id` LangGraph. Un checkpoint persistant (mémorisé par le checkpointer LangGraph) permet de reprendre une conversation **à l'état exact** où elle s'était arrêtée, non pas en rejouant les messages mais en restaurant le graphe.

**Distinction clé par rapport à l'état actuel** :
- Aujourd'hui : `browseSession()` réaffiche les messages sérialisés dans `SessionStore` (lecture seule, replay UI).
- Après migration : `switchSession(id)` charge le thread LangGraph via le checkpointer. Le prochain message repart de l'état réel du graphe.

**Source de vérité unique** : le LangGraph checkpointer remplace `SessionStore`. La liste des sessions pour toutes les façades (WebUI sidebar, TUI `--list-sessions`, Telegram historique) est lue depuis le checkpointer via le thread metadata (`title`, `updatedAt`, `messageCount`).

**TUI** :
- Ajouter le `thread_id` dans le header (ex : `· session abc123`) et une commande `--list-sessions` au démarrage qui interroge le checkpointer.
- State `resumable` re-câblé : affiché quand le thread metadata indique une interruption HITL en attente.

**WebUI** :
- `SessionSidebar` est déjà en place. `SessionHistoryEntry` est alimentée par le checkpointer au lieu de `SessionStore` — la forme reste identique.
- Un badge visuel "Resumable" sur les sessions dont le thread metadata indique une interruption HITL (`interruptValue !== null`).
- La mécanique `switchSession` → `setMessages([])` reste identique côté UI. Le gateway backend récupère les messages depuis le checkpoint LangGraph.

---

#### D. Compactage de contexte

**Ce que deepagentsjs apporte** : le compactage vient soit d'un seuil LangGraph natif (summarization node), soit d'un déclenchement explicite par Yagr (`/api/compact`).

**TUI** — déjà presque complet :
- `compactSummary(event)` est déjà écrit et produit un texte lisible (nb messages foldés, source LLM vs fallback).
- `handleCompaction()` pousse déjà une entrée lane `result`.
- **Seul changement** : rewirer `YagrContextCompactionEvent` depuis l'event LangGraph `on_chain_end` du nœud de summarization plutôt que depuis `run-engine.ts`.

**WebUI** — déjà presque complet :
- `contextFillPercent` + barre de remplissage + bouton "Compact" existent.
- Ajouter un `ChatProgressEntry` `info` dans le message assistant courant à la réception de l'event de compaction : "Context compacted — [N] messages folded." pour traçabilité dans le fil.
- Le bouton "Compact" déclenche un appel `POST /api/compact` → le gateway invoque `agent.invoke({ type: 'compact' })` — **travail backend**, l'UI ne change pas.

---

#### E. Interruption HITL (`waiting_for_permission`)

**Ce que deepagentsjs apporte** : le mécanisme `interruptOn` de LangGraph natif, distinct de l'actuel `requestRequiredAction` tool.

> Voir §5.2 du document : `requestRequiredAction` est conservé comme tool custom injecté pour ne pas bloquer la migration. L'adoption de `interruptOn` natif est une montée en version future.

**TUI** : state `waiting_for_permission` + `RequiredActionCard` déjà en place — aucun changement UI requis en phase 1.

**WebUI** : les `requiredActions` dans l'event `final` sont déjà consommés et affichés. Aucun changement UI requis en phase 1.

En phase 2 (adoption `interruptOn` natif) :
- **TUI** : l'interruption arrive via un event stream, pas en fin de run. Ajouter un handler `on_chain_interrupt` dans `langgraph-events.ts` qui émet `YagrStateEvent { state: 'waiting_for_permission' }`.
- **WebUI** : `ChatStreamEvent` étendu avec `| { type: 'interrupt'; actions: RequiredAction[] }` pour permettre l'affichage intermédiaire sans attendre l'event `final`.

---

### 11.3 Récapitulatif des changements par fichier

#### `src/gateway/interactive-ui.tsx`

| Changement | Nature |
|---|---|
| Rewire événements source vers `langgraph-events.ts` | Câblage (sans nouvelle UI) |
| Affichage `write_todos` comme lane `narrative` | Nouveau (minimal) |
| Affichage délégation `task` comme lane `action`/`result` | Nouveau (minimal) |
| Affichage `sessionId` dans le header | Nouveau (1 ligne) |
| Rewire `compacting` → event LangGraph summarization | Câblage |

#### `src/webui/app.tsx`

| Changement | Nature |
|---|---|
| Étendre `ChatStreamEvent` union | Nouveau (types) |
| Afficher `write_todos` dans `progressTicker` | Nouveau (minimal) |
| Afficher "Delegating…" progress entry pour `task` | Nouveau (minimal) |
| Badge "Resumable" sur sessions interrompues | Nouveau (conditionnel) |
| `ChatProgressEntry` à la réception de compaction | Nouveau (1 ligne de logique) |

#### `src/webui/store.ts`

| Changement | Nature |
|---|---|
| `currentTodos: TodoItem[]` dans `WebUiState` | Nouveau (état) |
| Action `setTodos` | Nouveau (action Zustand) |
| `checkpointId?: string` dans `SessionHistoryEntry` | Nouveau (type) |

#### `src/gateway/langgraph-events.ts` (nouveau fichier — §4.1)

Ce fichier est **le point d'entrée unique** de toutes les nouvelles informations deepagentsjs vers les UIs. Les changements UI ci-dessus sont tous déclenchés par de nouveaux events issus de ce fichier, jamais directement depuis LangGraph.

---

### 11.4 Ce qui n'est PAS dans le scope UI de la migration

- Refonte visuelle du chat WebUI
- Rendu markdown avancé des réponses
- Visualisation du graphe LangGraph (interne à l'agent, pas exposé)
- Replay audio / TTS
- Notifications push / webhook sortant

---

## 10. Glossaire

| Terme | Définition |
|---|---|
| **Deep Agents** | Framework agentique de LangChain (`deepagentsjs` en TypeScript, MIT) |
| **createDeepAgent** | Fonction principale de deepagentsjs pour créer un agent avec tools, system prompt et middlewares |
| **Checkpointer** | Mécanisme LangGraph de sauvegarde de l'état du graphe (thread par session) |
| **thread_id** | Identifiant de conversation LangGraph, mappé sur `PersistedSession.id` |
| **TodoListMiddleware** | Middleware deepagentsjs implémentant `write_todos` (planification dynamique) |
| **FilesystemMiddleware** | Middleware deepagentsjs fournissant nativement readFile, writeFile, grep, listDir, glob |
| **SubAgentMiddleware** | Middleware deepagentsjs permettant la délégation à des sous-agents (`task` tool) |
| **HITL** | Human-In-The-Loop — mécanisme d'interruption pour approbation utilisateur (`interruptOn`) |
| **Bridge** | Composant de synchronisation entre les événements LangGraph et les gateways Yagr |
| **YagrUserVisibleUpdate** | Interface stable côté gateways pour les updates UI (conservée après migration) |
| **n8nac** | CLI externe pour la manipulation de workflows n8n (`@n8n-as-code/skills`, `@n8n-as-code/transformer`) |
| **Proxy LLM** | Serveur HTTP OpenAI-compatible local (`llm-relay-server.ts`) qui proxifie vers le provider actif |
| **Engine Ports** | Interfaces TypeScript définissant les contrats entre Yagr et les backends n8n |
| **Thread metadata** | Dictionnaire arbitraire attaché à chaque thread LangGraph — stocke titre, date, compteur de messages pour les façades |
| **Memory Store** | Persistance file-based de la mémoire cross-session (`YAGR_HOME/memories/`) |
