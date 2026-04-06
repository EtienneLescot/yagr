# System Overview

Cette page decrit les grands blocs logiques actuellement presents dans le repo.

## Vue d'ensemble

```mermaid
flowchart TD
    User[User]

    subgraph Interfaces[Interfaces]
      Facades[WebUI / Telegram / CLI / TUI]
    end

    subgraph Application[Application]
      AF[agent-factory\ncreateYagrDeepAgent]
      DA[deepagentsjs\nLangGraph]
      EVT[langgraph-events\nadaptateur events]
      Setup[Setup Application Services]
    end

    subgraph Infra[Infrastructure]
      LLM[LangChain BaseChatModel\ncreate-langchain-model]
      Tools[LangChain Tools\ntools/ + manager-tooling/]
      Engine[Engine Ports\nn8n Engine]
      Checkpointer[MemorySaver\ncheckpointer par thread]
      Config[Config Services]
      N8nLocal[Managed Local n8n]
    end

    subgraph Relay[Relay LLM pour n8n]
      Proxy[proxy-runtime\nllm-relay-server]
      Accounts[*-account.ts\nCopilot / OpenAI / Anthropic]
    end

    User --> Facades
    Facades --> EVT
    EVT --> DA
    DA --> AF
    AF --> LLM
    AF --> Tools
    AF --> Checkpointer
    Facades --> Setup
    Tools --> Engine
    LLM --> Accounts
    Setup --> Config
    Setup --> N8nLocal
    Setup --> Relay
```

## Blocs principaux

### Boucle agentique (deepagentsjs)

- `src/agent-factory.ts`: `createYagrDeepAgent(engine, configService)` → `YagrDeepAgentHandle`
- `deepagentsjs`: `createDeepAgent({ model, tools, systemPrompt, checkpointer })` — LangGraph sous le capot
- `src/gateway/langgraph-events.ts`: adaptateur events LangGraph → `YagrUserVisibleUpdate`
- `src/prompt/build-system-prompt.ts`: composition du system prompt (engine, tunnel, n8n host, workspace instructions, memoire cross-session)

**Deleted:**
- `src/agent.ts` (`YagrSessionAgent`) — supprimé
- `src/runtime/` (7 fichiers) — supprimé

### LLM / providers

Deux couches distinctes :

**Couche agent (LangChain)** — utilisée par deepagentsjs :
- `src/llm/create-langchain-model.ts` : factory `BaseChatModel` + resolution config
- `src/llm/*-account.ts` : auth OAuth (Copilot Device Flow, OpenAI Codex, Claude Pro/Max)

**Couche relay (Vercel AI SDK)** — utilisée par le relay proxy n8n :
- `src/llm/proxy-runtime.ts` + `llm-relay-server.ts` : relay OpenAI-compatible local
- `src/llm/provider-plugin.ts` + `provider-registry.ts` : plugins provider avec factory Vercel AI SDK
- `src/llm/capability-resolver.ts` + `model-capabilities.ts` : classification capacite (relay uniquement)

**Deleted:** `src/llm/create-language-model.ts` — supprimé.

### N8N Cloudflare Tunnel Exposure

Yagr peut exposer toute instance n8n **locale** via un tunnel Cloudflare, rendant les webhooks accessibles depuis l'exterieur (Telegram, machines distantes, services tiers).

**Composants implementes**

| Fichier | Role |
|---|---|
| `src/n8n-local/n8n-tunnel.ts` | Module `N8nTunnelManager` : start/stop/refresh/status, persistance dans `YAGR_HOME/n8n-tunnel-state.json`, auto-install de `cloudflared` |
| `src/config/yagr-config-service.ts` | `N8nTunnelConfig` : `enabled`, `publicUrl`, `targetUrl` |
| `src/gateway/workflow-links.ts` | Substitution de l'URL locale par l'URL tunnel publique quand active |
| `src/prompt/build-system-prompt.ts` | Injection de l'URL tunnel publique dans le system prompt |

**Flux operationnel**

```
yagr n8n tunnel start
  → resolveN8nTunnelTargetUrl()        → URL locale n8n (managed uniquement)
  → installCloudflaredIfNeeded()       → telecharge cloudflared si absent
  → startN8nTunnel(targetUrl)          → spawn cloudflared tunnel --url <targetUrl>
  → detecte URL trycloudflare.com      → parse le log file
  → persiste N8nTunnelState            → YAGR_HOME/n8n-tunnel-state.json
  → restartManagedN8nForTunnel()       → redemarre n8n avec N8N_WEBHOOK_URL
```

**Portee et limitations**

- Le tunnel ne s'applique qu'aux instances **locales** (Yagr-managed direct). Les instances cloud/distante sont deja publiques.
- Deux tunnels distincts coexistent : Tunnel A (LLM Proxy) et Tunnel B (N8N Webhook Exposure).
- Les URL `trycloudflare.com` changent a chaque restart — le systeme supporte `refresh` manuel.
- `N8N_WEBHOOK_URL` est positionne au demarrage n8n ; un refresh tunnel propose un redemarrage explicite.
- Le tunnel expose une surface **non authentifiee** par defaut pour les webhooks.

**Commandes CLI**

| Commande | Description |
|---|---|
| `yagr n8n tunnel setup` | Installe cloudflared automatiquement |
| `yagr n8n tunnel start` | Demarre le tunnel |
| `yagr n8n tunnel stop` | Arrete le tunnel |
| `yagr n8n tunnel refresh` | Renouvelle l'URL |
| `yagr n8n tunnel status` | Affiche l'etat courant |
| `yagr n8n tunnel url` | Retourne l'URL publique seule |

### LLM Relay Proxy (Yagr → n8n)

Yagr expose un serveur HTTP OpenAI-compatible local (`llm-relay-server.ts`) qui proxifie vers le provider actif de Yagr. Les noeuds Chat Model n8n (ex: `lmChatOpenAi`) peuvent pointer sur ce relay via une credential `openAiApi` avec `baseUrl` custom — sans necessiter de cle API separee.

**Composants implementes**

| Fichier | Role |
|---|---|
| `src/llm/llm-relay-server.ts` | Cycle de vie du relay : demarrage, detection de port libre, health-check, arret |
| `src/llm/llm-relay-entrypoint.ts` | Point d'entree du processus relay detache |
| `src/llm/anthropic-relay.ts` | Adaptation de format Anthropic → OpenAI pour le relay |
| `src/llm/proxy-runtime.ts` | Preparation du runtime provider pour le relay |

**Flux operationnel**

```
n8nac action=yagr_proxy_relay_start
  → ensureN8nRelayServer()            // demarre le relay si mort, idempotent
  → cree/reuse la credential openAiApi dans n8n (nom fixe "Yagr LLM Proxy")
  → retourne { port, baseUrl, credentialId }
  → l'agent assigne credentialId au noeud lmChatOpenAi

n8n execute le workflow
  → lmChatOpenAi appelle http://host.docker.internal:PORT/v1/chat/completions
  → relay proxifie vers le provider actif Yagr (Copilot, Anthropic, OpenAI, etc.)
  → rotation de token transparente (le relay fait l'intermediaire en temps reel)
```

**Points d'attention**

- Le relay tourne como processus detache qui survit a la session agent ; il est redemarre automatiquement au prochain lancement de `ensureRelayAtLaunch()` si mort
- Le noeud `lmChatOpenAi` v1.3 exige `responsesApiEnabled: false` quand une `baseURL` custom est configuree — sinon n8n envoie la requete a `api.openai.com/v1/responses` en ignorant la `baseURL`
- Quand n8nac test retourne `asyncTrigger=true` (`{"message":"Workflow was started"}`), l'execution est asynchrone ; l'agent doit enchaîner avec `execution list/get` pour confirmer le statut reel

```mermaid
flowchart LR
    CFG[Resolved config]
    REG[provider-registry]
    PLUG[ProviderPlugin]
    META[provider-metadata]
    CAP[capability-resolver]
    FACT[plugin factory]
    SDK[AI SDK model]
    DISC[plugin discovery]

    CFG --> REG
    REG --> PLUG
    PLUG --> DISC
    DISC --> META
    META --> CAP
    CAP --> FACT
    PLUG --> FACT
    FACT --> SDK
```

### Tooling

**Outils generalistes (`src/tools/`) :**

- `src/tools/build-tools.ts`
- `src/tools/toolsets.ts`
- `src/tools/*.ts` (FS, shell, HTTP, status)
- `src/runtime/tool-runtime-strategy.ts`
- `src/runtime/policy-hooks.ts`

**Tooling manager (`src/manager-tooling/`) :**

- `src/manager-tooling/present-workflow.ts` — Tool `presentWorkflowResult`
- `src/manager-tooling/yagr-proxy.ts` — Tool `yagrProxy`
- `src/manager-tooling/YAGENTS.md` — Instructions injectees dans le system prompt

Responsabilite actuelle:

- `src/tools/` : construire la surface d'outils generalistes exposee au runtime
- `src/manager-tooling/` : outillage specifique yagr-manager, enregistre dynamiquement
- normaliser les groupes d'outils et les contraintes post-sync
- faire porter par la strategie runtime la selection de surface et le mode de tool calling

#### Doctrine d'outillage

> Yagr est un agent generaliste de codage et d'orchestration, avec une fine surcouche d'outillage dediee a n8n.

La regle est simple : **qui peut le plus peut le moins**. Un agent capable de lire n'importe quel fichier peut lire un fichier de workflow. Un outil de recherche generique peut chercher dans un workspace n8nac. L'outillage n8n-specifique ne doit couvrir que ce qu'un outil generaliste ne peut pas faire par construction.

Les outils sont organises en trois couches :

```
┌─────────────────────────────────────────────────────────────────┐
│  COUCHE 1 — Capacites generalistes (src/tools/)                 │
│                                                                 │
│  readFile   grep   listDir                                      │
│  ↳ absolute=true pour sortir du sandbox workspace              │
│                                                                 │
│  writeFile  replaceInFile  moveFile  deleteFile                 │
│                                                                 │
│  httpRequest   — appels HTTP arbitraires (API REST, relay…)    │
│  runScript     — shell restraint (allowlist : build/test/git)  │
│  runShell      — shell libre, opt-in via YAGR_ENABLE_SHELL=1   │
│  reportProgress   requestRequiredAction                        │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│  COUCHE 2 — Orchestration n8n via n8nac (dependance externe)   │
│                                                                 │
│  n8nac action=command          — tout npx n8nac <args>         │
│  n8nac action=yagr_proxy_relay_start — demarrage relay + cred  │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│  COUCHE 3 — Specificites Yagr (src/manager-tooling/)            │
│                                                                 │
│  presentWorkflowResult — URL canonique + diagramme ASCII        │
│  yagrProxy — proxy LLM + credential n8n                         │
│  YAGENTS.md — instructions manager pour l'agent                 │
└─────────────────────────────────────────────────────────────────┘
```

Outils FS et leur scope :

| Outil | Scope par defaut | Scope etendu |
|---|---|---|
| `readFile` | workspace n8nac | `absolute=true` → tout le FS |
| `grep` | workspace n8nac | `absolute=true` → tout le FS |
| `listDir` | workspace n8nac | `absolute=true` → tout le FS |
| `writeFile` | workspace n8nac | — |
| `replaceInFile` | workspace n8nac | — |
| `moveFile` | workspace n8nac | — |
| `deleteFile` | workspace n8nac | — |

Les outils d'ecriture restent intentionnellement sandboxes au workspace. Les outils de lecture acceptent `absolute=true` pour sortir du sandbox.

**runScript (allowlist)** : commandes autorisees : `npm run`, `npm test`, `npx tsc`, `node --test`, `git status/diff/log`, `node -e`, `cat`, `ls`, `find`. Toujours disponible.

**runShell (opt-in)** : shell bash libre. Desactive par defaut. Activation : `YAGR_ENABLE_SHELL=1`. Ne jamais activer par defaut — permet des operations irreversibles.

#### Regles d'evolution

1. Avant d'ajouter un outil n8n-specifique, verifier si un outil generaliste (httpRequest, runScript, FS) ne suffit pas.
2. Les outils d'ecriture FS restent sandboxes au workspace par defaut.
3. `runShell` reste opt-in, avec warning explicite dans sa description.
4. `n8nac` reste une dependance externe, jamais reimplementee dans le core.
5. `presentWorkflowResult` doit etre appele systematiquement quand l'agent manipule un workflow connu.
6. Les outils n8n-specific vivent dans `src/manager-tooling/`, pas dans `src/tools/`.

#### Observation actuelle

- `src/tools/toolsets.ts` definit le SSOT des groupes d'outils runtime (`core`, `discovery`, `edit`, `workflow execution`)
- `src/runtime/tool-runtime-strategy.ts` choisit explicitement la surface exposee, le mode `parallel / sequential / disabled` et les tools autorises apres un `push/verify`
- `src/runtime/policy-hooks.ts` consomme cette politique runtime au lieu de porter sa propre allowlist implicite
- la surface reste plate cote implementation, filtree et contrainte selon `native / compatible / weak / none`
- le bridge `n8nac` privilegie le repertoire de sync actif lors des retries `push`
- le tool `presentWorkflowResult` est traite comme une sortie produit de premier plan : le harness `advanced` verifie la presence d'une banniere workflow complete avec URL et diagramme
- le diagramme workflow est valide via `src/gateway/workflow-diagram.ts` avant presentation
- la resolution du runtime n8n est partagee entre guard runtime et bridge `n8nac`
- `N8N_HOST` / `N8N_API_KEY` ne sont pris en compte que lorsque le harness active explicitement `YAGR_ALLOW_N8N_ENV=1`
- les required actions non bloquantes ne forcent plus l'arret d'un run qui a deja un resultat concret
- les outils n8n-specific (`presentWorkflowResult`, `yagrProxy`) ont ete extraits vers `src/manager-tooling/` pour que yagr-agent reste agnostique

### Gateway / facades

- `src/gateway/telegram.ts`
- `src/gateway/webui.ts`
- `src/gateway/cli.ts`
- `src/gateway/manager.ts`
- `src/gateway/interactive-ui.tsx`

Responsabilite actuelle:

- exposer l'agent via Telegram, WebUI, CLI et TUI
- gerer les sessions facade-side
- afficher le statut des surfaces et demarrer les runtimes de gateway

Observation actuelle:

- les facades se limitent maintenant a l'I/O, aux sessions et a une orchestration legere
- les mutations setup/config et l'etat metier associe sont delegues aux services applicatifs partages
- les surfaces partagent maintenant une base unifiee pour les updates montrables; la prose assistant intermediaire ne doit plus etre le canal principal de progression

```mermaid
flowchart LR
    UI[WebUI / Telegram / CLI / TUI]
    GW[gateway handlers]
    SA[YagrSessionAgent]
    SS[setup/status]
    AS[setup/application-services]
    CFG[config services]
    N8N[n8n-local / n8n API]

    UI --> GW
    GW --> SA
    GW --> SS
    GW --> AS
    AS --> CFG
    AS --> N8N
```

### Setup / wizard / bootstrap

- `src/setup.ts`
- `src/setup/application-services.ts`
- `src/setup/status.ts`
- `src/setup/setup-wizard.tsx`
- `src/n8n-local/*`

Responsabilite actuelle:

- services applicatifs partages pour setup n8n, LLM et surfaces
- calcul partage du statut setup
- onboarding n8n
- onboarding provider LLM
- onboarding Telegram
- bootstrap local managed n8n

Observation actuelle:

- `src/setup/application-services.ts` centralise maintenant les mutations principales de setup/configuration pour n8n, LLM, surfaces et Telegram
- `src/setup/status.ts` porte maintenant le calcul partage de `YagrSetupStatus`
- la WebUI demande maintenant son snapshot de configuration au service applicatif au lieu de reconstituer localement toute la vue setup/config
- la facade Telegram delegue maintenant au service applicatif le setup/reset et les mutations d'etat des chats lies
- `src/setup.ts` reste un point d'orchestration/wizard, mais n'est plus le lieu principal des mutations setup/config

### Configuration et SSOT local

- `src/config/yagr-config-service.ts`
- `src/config/n8n-config-service.ts`
- `src/config/*`

Responsabilite actuelle:

- configuration locale Yagr
- credentials providers
- credentials n8n
- chemins Yagr home
- etat local et daemon/gateway config

Observation actuelle:

- la source de verite normale pour n8n reste la config locale Yagr/n8n persistee
- le fallback environnement n8n est reserve aux tests automatises et doit etre active explicitement

## Frontieres actuelles

```mermaid
flowchart LR
    subgraph Interfaces
      TG[Telegram]
      WEB[WebUI]
      CLI[CLI]
      TUI[TUI]
    end

    subgraph Application
      AG[YagrSessionAgent]
      RE[YagrRunEngine]
      AS[setup/application-services]
      ST[setup/status]
    end

    subgraph RuntimePolicy
      STRAT[tool-runtime-strategy]
      TOOLS[buildTools + toolsets]
    end

    subgraph Infrastructure
      LLM[Provider Plugins + AI SDK]
      ENG[Engine Ports / n8n Engine]
      CFG[Config Services]
      N8NLOCAL[n8n-local]
    end

    TG --> AG
    WEB --> AG
    CLI --> AG
    TUI --> AG
    TG --> AS
    WEB --> AS
    CLI --> AS
    AG --> RE
    WEB --> ST
    RE --> STRAT
    RE --> LLM
    RE --> TOOLS
    TOOLS --> ENG
    AS --> CFG
    AS --> N8NLOCAL
```

## Points d'attention actuels

- Le contrat `Engine` agrege encore plusieurs responsabilites pour compatibilite, meme si le prompt, le runtime et les gateways consomment deja des ports plus fins (`EngineIdentityPort`, `EngineRuntimePort`, etc.).
- `setup.ts` reste un point d'orchestration historique, meme si les mutations et snapshots principaux sont remontes dans `setup/application-services.ts` et `setup/status.ts`.
- La capture de la reponse finale utilisateur et de la banniere workflow est maintenant bonne cote harness, mais la qualite redactionnelle varie encore selon les providers/modeles.
