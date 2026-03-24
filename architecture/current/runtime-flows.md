# Runtime Flows

Cette page documente les flux transverses principaux du repo tel qu'il fonctionne aujourd'hui.

## 1. Message entrant vers execution agentique

```mermaid
sequenceDiagram
    participant U as User
    participant F as Facade
    participant A as YagrAgent
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

## 2. Setup et onboarding

```mermaid
sequenceDiagram
    participant UI as Wizard or WebUI
    participant S as setup.ts callbacks or WebUI handlers
    participant AS as setup/application-services
    participant YC as YagrConfigService
    participant NC as YagrN8nConfigService
    participant PR as Provider Runtime
    participant NL as n8n-local
    participant N8N as n8n API

    UI->>S: action de setup
    S->>AS: shared setup operation
    AS->>N8N: testConnection/getProjects
    AS->>NC: save api key and local config
    S->>NL: optional managed bootstrap
    UI->>S: prepare provider
    S->>AS: prepare provider
    AS->>PR: auth/runtime/models
    AS->>YC: save provider config
    UI->>S: save surfaces
    S->>AS: save surfaces
    AS->>YC: save gateway config
```

## 3. Flux provider actuel

```mermaid
flowchart TD
    CFG[Stored config] --> RES[resolveLanguageModelConfig]
    RES --> REG[provider-registry]
    RES --> CLM[create-language-model]
    REG --> DISC[provider-discovery]
    DISC --> META[provider-metadata cache]
    META --> CAP[capability-resolver]
    REG --> CLM
    PR[proxy-runtime] --> DISC
    PR --> ACC[account auth files and sessions]
    ACC --> CLM
    CLM --> SDK[AI SDK model]
    CAP --> RTS[tool-runtime-strategy]
    RTS --> RT[Runtime]
    SDK --> RT[Runtime]
```

Observation:

- le flux comporte maintenant un debut de couche distincte entre metadata provider, normalisation des capacites et strategie runtime
- la migration n'est pas encore complete pour tous les providers ni pour tous les cas dynamiques

## 4. Flux facade WebUI actuel

```mermaid
flowchart TD
    WEB[WebUiGateway]
    WEB --> API[HTTP handlers]
    API --> CFG[Config Services]
    API --> SETUP[getYagrSetupStatus]
    API --> N8N[N8nApiClient and workspace refresh]
    API --> LLM[fetchAvailableModels]
    API --> AG[Agent sessions]

    note1[La WebUI agit a la fois comme facade et comme point d'orchestration applicative]
```

## 5. Regle de maintenance

Quand un flux transverse change, il faut:

- mettre a jour le graphe Mermaid
- verifier que les noms de modules correspondent encore au repo
- signaler clairement tout nouveau couplage transverse
