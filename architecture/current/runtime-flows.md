# Runtime Flows

Cette page documente les flux transverses principaux du repo tel qu'il fonctionne aujourd'hui.

## 1. Message entrant vers execution agentique

```mermaid
sequenceDiagram
    participant U as User
    participant F as Facade
    participant A as YagrSessionAgent
    participant R as YagrRunEngine
    participant S as Runtime Strategy
    participant M as LLM Layer
    participant T as Tool Surface
    participant E as Engine

    U->>F: prompt
    F->>A: run(prompt)
    A->>R: execute(prompt, options)
    R->>S: resolveToolRuntimeStrategy()
    R->>M: createLanguageModel()
    R->>T: buildTools(engine, strategy)
    M-->>R: model
    S-->>R: execution mode, tool policy, step limits
    T-->>R: tools
    R->>M: stream/generate
    M->>T: tool call(s)
    T->>E: engine operations when needed
    E-->>T: results
    T-->>R: tool results
    R-->>A: final result
    A-->>F: response and events
    F-->>U: rendered output
```

Observation:

- les facades conversationnelles passent maintenant par `YagrSessionAgent`
- `YagrRunEngine` choisit lui-meme la strategie runtime, la surface d'outils et les hooks associes
- le flux est maintenant explicitement pilote par `tool-runtime-strategy.ts`

## 2. Setup et onboarding

```mermaid
sequenceDiagram
    participant UI as Wizard or WebUI
    participant H as setup.ts callbacks or gateway handlers
    participant AS as setup/application-services
    participant ST as setup/status
    participant YC as YagrConfigService
    participant NC as YagrN8nConfigService
    participant PR as Provider Runtime
    participant NL as n8n-local
    participant N8N as n8n API

    UI->>H: action de setup
    H->>AS: shared setup operation
    AS->>N8N: testConnection/getProjects
    AS->>NC: save api key and local config
    H->>NL: optional managed bootstrap
    UI->>H: prepare provider
    H->>AS: prepare provider
    AS->>PR: auth/runtime/models
    AS->>YC: save provider config
    UI->>H: save surfaces
    H->>AS: save surfaces
    AS->>YC: save gateway config
    UI->>H: read status/snapshot
    H->>ST: compute setup status
    H->>AS: build shared setup snapshot
```

Observation:

- les facades ne portent plus directement les mutations de config metier
- `application-services.ts` et `status.ts` sont maintenant le point commun de setup/lecture de statut

## 3. Flux provider actuel

```mermaid
flowchart TD
    CFG[Stored config] --> RES[resolveLanguageModelConfig]
    RES --> REG[provider-registry]
    RES --> CLM[create-language-model]
    REG --> PLUG[ProviderPlugin]
    PLUG --> DISC[provider-discovery]
    DISC --> META[provider-metadata cache]
    META --> CAP[capability-resolver]
    PLUG --> CLM
    PR[proxy-runtime] --> DISC
    PR --> ACC[account auth files and sessions]
    ACC --> PLUG
    CLM --> SDK[AI SDK model via plugin factory]
    CAP --> RTS[tool-runtime-strategy]
    RTS --> RT[Runtime]
    SDK --> RT[Runtime]
```

Observation:

- `ProviderPlugin` porte maintenant discovery, metadata hooks et factory de modele
- le flux est maintenant structurellement `metadata -> normalisation -> runtime strategy`
- `google-proxy` n'est plus un provider supporte en surface, meme si son code interne existe encore

## 4. Flux tooling/runtime actuel

```mermaid
flowchart LR
    CAP[Resolved capability profile]
    STRAT[tool-runtime-strategy]
    SETS[tools/toolsets]
    BUILD[build-tools]
    HOOKS[policy-hooks]
    RUN[YagrRunEngine]
    TOOLS[Runtime tools]

    CAP --> STRAT
    STRAT --> SETS
    STRAT --> BUILD
    STRAT --> HOOKS
    BUILD --> TOOLS
    HOOKS --> TOOLS
    TOOLS --> RUN
    RUN --> STRAT
```

Observation:

- `toolsets.ts` est maintenant le SSOT des groupes d'outils
- `tool-runtime-strategy.ts` choisit la surface exposee, le mode de tool calling et la politique post-sync
- `policy-hooks.ts` applique cette politique au lieu de porter ses propres regles implicites

## 5. Flux facade WebUI actuel

```mermaid
flowchart TD
    WEB[WebUiGateway]
    WEB --> API[HTTP handlers]
    API --> AS[setup/application-services]
    API --> ST[setup/status]
    API --> N8N[N8nApiClient and workspace refresh]
    API --> LLM[fetchAvailableModels]
    API --> AG[Agent sessions]
```

Observation:

- la WebUI reste une facade HTTP avec un peu d'orchestration technique
- les lectures de statut et snapshots de setup passent maintenant par la couche applicative partagee

## 6. Regle de maintenance

Quand un flux transverse change, il faut:

- mettre a jour le graphe Mermaid
- verifier que les noms de modules correspondent encore au repo
- signaler clairement tout nouveau couplage transverse
