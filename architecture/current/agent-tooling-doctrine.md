# Agent Tooling Doctrine

Ce document decrit la doctrine d'outillage de Yagr : comment les capacites de l'agent sont organisees, ce qui est generaliste, ce qui est specifique, et pourquoi.

## Principe directeur

> Yagr est un agent generaliste de codage et d'orchestration, avec une fine surcouche d'outillage dediee a n8n.

La regle est simple : **qui peut le plus peut le moins**. Un agent capable de lire n'importe quel fichier peut lire un fichier de workflow. Un outil de recherche generique peut chercher dans un workspace n8nac.

L'outillage n8n-specifique ne doit couvrir que ce qu'un outil generaliste ne peut pas faire par construction : appeler la CLI `n8nac`, piloter le relay LLM, presenter les workflows avec leur URL et leur diagramme.

---

## Trois couches

```
┌─────────────────────────────────────────────────────────────────┐
│  COUCHE 1 — Capacites generalistes                              │
│                                                                 │
│  readWorkspaceFile   searchWorkspace   listDirectory            │
│  ↳ absolute=true pour sortir du sandbox workspace              │
│                                                                 │
│  writeWorkspaceFile  replaceInWorkspaceFile                     │
│  moveWorkspaceFile   deleteWorkspaceFile                        │
│                                                                 │
│  httpRequest   — appels HTTP arbitraires (API REST, relay…)    │
│  runScript     — shell restraint (allowlist : build/test/git)  │
│  runShell      — shell libre, opt-in via YAGR_ENABLE_SHELL=1   │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│  COUCHE 2 — Orchestration n8n via n8nac (dependance externe)   │
│                                                                 │
│  n8nac action=command          — tout npx n8nac <args>         │
│  n8nac action=yagr_proxy_relay_start — demarrage relay + cred  │
│  n8nac action=llm_provider_options   — liste des providers     │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│  COUCHE 3 — Specificites Yagr (thin layer)                     │
│                                                                 │
│  presentWorkflowResult — URL + diagramme ASCII du workflow     │
│  llm-relay-server.ts   — proxy LLM OpenAI-compatible           │
│  llm-proxy-setup       — wizard de configuration credential    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Couche 1 : capacites generalistes

### Outils FS (lecture / ecriture)

| Outil | Scope par defaut | Scope etendu |
|---|---|---|
| `readWorkspaceFile` | workspace n8nac | `absolute=true` → tout le FS |
| `searchWorkspace` | workspace n8nac | `absolute=true` → tout le FS |
| `listDirectory` | workspace n8nac | `absolute=true` → tout le FS |
| `writeWorkspaceFile` | workspace n8nac | — |
| `replaceInWorkspaceFile` | workspace n8nac | — |
| `moveWorkspaceFile` | workspace n8nac | — |
| `deleteWorkspaceFile` | workspace n8nac | — |

Les outils d'ecriture restent intentionnellement sandboxes au workspace pour eviter des modifications involontaires hors du contexte n8n.

### httpRequest

Appels HTTP directs depuis l'agent. Utile pour :
- interroger l'API REST n8n (credentials, workflows, executions)
- sonder le relay LLM (`/v1/models`, `/v1/responses`)
- valider l'etat d'un service local

### runScript (allowlist)

Shell restraint. Seules les commandes de la liste blanche sont autorisees :
- build / tests : `npm run`, `npm test`, `npx tsc`, `node --test`
- git (lecture seule) : `git status`, `git diff`, `git log`
- inspection : `node -e`, `cat`, `ls`, `find`

Toujours disponible. Ne necessite pas de configuration.

### runShell (opt-in)

Shell bash libre, sans restriction. **Desactive par defaut.**

Activation : `YAGR_ENABLE_SHELL=1`

Cette option donne a l'agent la meme puissance qu'un developer humain au terminal. Elle est explicitement opt-in car elle permet des operations irreversibles (suppression de fichiers, push git, etc.).

---

## Couche 2 : orchestration n8n via n8nac

`n8nac` est une dependance npm externe (`npx n8nac`) qui expose :
- la synchronisation workspace ↔ n8n (push, pull, resolve)
- la gestion des credentials n8n
- l'ecriture des fichiers `.workflow.ts`

L'outil `n8nac` de Yagr est un adaptateur mince autour de cette CLI. Il ne reimplement pas de logique n8n — il delege tout a la dependance.

Ce choix permet de maintenir n8nac independamment de Yagr et de beneficier de ses mises a jour sans modifier le core de l'agent.

---

## Couche 3 : specificites Yagr (thin layer)

Seules trois responsabilites sont specifiques a Yagr et ne peuvent pas etre delegees a une dependance generique :

1. **`presentWorkflowResult`** : formatage riche avec URL n8n et diagramme ASCII pour les surfaces (TUI, WebUI, Telegram). Depend du contexte de surface, pas du contenu du workflow.

2. **llm-relay-server** : proxy HTTP qui permet a n8n (Docker) d'appeler le LLM configure dans Yagr, avec traduction des formats d'API (Responses API → Chat Completions). Specifique a l'integration Yagr + n8n + LLM.

3. **llm-proxy-setup** : wizard de configuration du credential `Yagr LLM Proxy` dans n8n. Specifique a la combinaison n8n credential + adresse Docker (`host.docker.internal`).

---

## Regles d'evolution

1. **Avant d'ajouter un outil n8n-specifique**, verifier si un outil generaliste (httpRequest, runScript, FS) ne suffit pas.

2. **Les outils d'ecriture FS restent sandboxes** au workspace n8nac par defaut. Etendre via `absolute=true` seulement en lecture.

3. **runShell reste opt-in** et accompagne toujours d'un warning explicite dans sa description. Ne jamais le rendre actif par defaut.

4. **n8nac reste une dependance externe**, jamais reimplementee dans le core. Ses capacites evoluent independamment.

5. **presentWorkflowResult doit etre appele systematiquement** quand l'agent manipule un workflow connu, pour garantir la coherence des surfaces riches.
