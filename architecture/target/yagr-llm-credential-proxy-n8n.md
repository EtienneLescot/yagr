# Spec — Propagation des credentials LLM Yagr vers les nœuds Langchain N8N

## Contexte

Yagr (aka Jagger) peut recevoir des providers LLM via des mécanismes variés : clé API statique, OAuth, Device Flow (ex : Copilot, Codex/OpenAI PKCE). Lorsque Yagr génère des workflows N8N contenant des nœuds agents Langchain, ces nœuds nécessitent des credentials N8N natives — un silo complètement étanche des credentials Yagr.

L'objectif de cette feature est d'offrir une expérience **frictionless** : un utilisateur authentifié uniquement via OAuth ou Device Flow n'a aucune clé API à saisir pour que ses workflows N8N soient fonctionnels.

---

## Solution retenue : Option C — Proxy OpenAI-compatible local Yagr

### Principe

Yagr expose un serveur HTTP OpenAI-compatible sur `localhost:PORT` qui proxifie vers le provider actif de Yagr. Dans N8N, une credential `openAiApi` est créée pointant sur ce serveur local avec une fake API key Yagr.

### Avantages

- Compatible avec **tous les providers** Yagr, y compris OAuth et Device Flow
- Utilise des credentials N8N natives (`openAiApi` avec `baseUrl` custom) — pas de nœud custom à installer
- Rotation de token transparente (le proxy fait l'intermédiaire en temps réel)
- `proxy-runtime.ts` existe déjà dans le codebase — fondation réutilisable
- Centralise les contrôles en un seul point

### Contrainte obligatoire

Yagr doit tourner pendant l'exécution des workflows N8N utilisant le proxy.

---

## Compliance et responsabilité utilisateur

### Principe

- Un **warning unique** est affiché la première fois que l'utilisateur choisit d'utiliser le provider Yagr dans un workflow N8N
- Aucun quota, aucune limitation produit par la suite
- La responsabilité de l'usage est transférée à l'utilisateur après consentement explicite

### Consentement versionné

Un flag de consentement est stocké avec :
- Horodatage
- Version du texte du warning

Ce flag ne déclenche plus d'affichage **sauf si le texte légal est mis à jour** (nouvelle version).

### Texte du warning (à afficher une seule fois)

> **Utilisation du provider Yagr dans les workflows N8N**
>
> En choisissant ce mode, les appels LLM de vos workflows N8N seront routés via le provider actuellement connecté dans Yagr (ex : GitHub Copilot, OpenAI via OAuth).
>
> ⚠️ L'utilisation automatisée ou à grande échelle peut être contraire aux conditions d'utilisation de votre provider. Vous êtes seul responsable du respect de ces conditions.
>
> [J'ai compris, continuer sans clé API]

---

## Architecture technique

### Composants

| Composant | Rôle |
|---|---|
| `proxy-runtime.ts` | Serveur HTTP OpenAI-compatible local, fondation existante |
| `N8nCredentialSyncService` | Crée/upsert la credential `openAiApi` avec `baseUrl` pointant vers le proxy Yagr |
| `N8nLlmCredentialOrchestrator` | State machine déterministe de configuration des credentials par nœud LLM |
| Système prompt Jagger (update) | Indique à Jagger qu'il peut proposer le provider Yagr lors du setup de credentials |

### Flux de configuration (par workflow)

La configuration des credentials est orchestrée par une **state machine déterministe** par nœud LLM agent. Le LLM (Jagger) assure uniquement la couche conversationnelle — formulation des questions, reformulation des options — mais **ne pilote pas la logique de transition d'état**.

```
Pour chaque nœud LLM agent dans le workflow :
  ┌─────────────────────────────────────────────────────────┐
  │ Question : Quel provider LLM pour ce nœud ?             │
  │  - Yagr (aucune clé API requise)  ← si choisi           │
  │  - OpenAI                                               │
  │  - Gemini                                               │
  │  - [liste des nœuds LLM N8N disponibles via N8NAC]      │
  └─────────────────────────────────────────────────────────┘
         │                        │
    [Yagr]                  [Provider externe]
         │                        │
  Credential proxy Yagr       Proposer :
  existante ?                  1. Credential existante
    Oui → assigner             2. Créer maintenant (clé API)
    Non → créer proxy             → saisir clé (mention sécurité)
          + warning unique         → créer credential N8NAC
          + consentement           → assigner
          → assigner            3. Configurer plus tard dans l'UI
                                   → nœud marqué "pending credential"
```

### Règle du warning unique

```
si credential_proxy_yagr_existe → pas de warning
si credential_proxy_yagr_absente ET consentement_versionné_absent → afficher warning + demander confirmation
si credential_proxy_yagr_absente ET consentement_versionné_présent ET version_identique → créer silencieusement
si consentement_versionné_présent ET version_différente → réafficher warning
```

### Finalisation

Avant le push du workflow :
1. Résumé des choix provider par nœud
2. Signalement clair des nœuds en état `pending credential`
3. Instructions précises pour finaliser via l'UI N8N si nécessaire

---

## Scénario utilisateur complet (instance vierge)

```
Jagger crée un workflow avec 4 agents LLM.

Agent 1 → Yagr choisi
  → Aucune credential proxy existante
  → Warning affiché + consentement stocké
  → Credential "Yagr LLM Proxy" créée dans N8NAC

Agent 2 → OpenAI choisi
  → "Entrer la clé maintenant (moins sécurisé) ou dans l'UI (recommandé) ?"
  → Utilisateur entre la clé → credential "OpenAI - cred1" créée

Agent 3 → Yagr choisi
  → Credential proxy existante + consentement stocké → assignée silencieusement

Agent 4 → OpenAI choisi
  → "Utiliser une credential existante ?"
  → cred1 proposée (créée pour agent 2) → sélectionnée, assignée directement

Résumé final :
  - Agent 1 : Yagr Proxy ✅
  - Agent 2 : OpenAI cred1 ✅
  - Agent 3 : Yagr Proxy ✅
  - Agent 4 : OpenAI cred1 ✅
  → Workflow poussé vers N8N
```

---

## Périmètre d'implémentation

### Étapes

1. **Mise à jour de N8NAC** via npm pour disposer des dernières fonctionnalités de gestion des credentials et d'exécution (listé des credentials disponibles, création de credentials, etc.)
2. **Étendre `proxy-runtime.ts`** : s'assurer que le proxy local est démarrable en mode standalone et expose un endpoint OpenAI-compatible stable
3. **Créer `N8nCredentialSyncService`** : création/upsert d'une credential `openAiApi` dans N8N pointant sur le proxy local
4. **Créer `N8nLlmCredentialOrchestrator`** : state machine de configuration par nœud, intégrant la logique de warning + consentement versionné
5. **Mettre à jour le système prompt Jagger** : indiquer la disponibilité du provider Yagr frictionless lors du setup de credentials de workflow
6. **Stocker le consentement** : fichier local versionné dans `~/.yagr/` (ex : `n8n-proxy-consent.json`)

### Hors périmètre

- Quotas et rate-limiting côté proxy (responsabilité utilisateur après consentement)
- Support multi-instance N8N (scope : N8N local managé par Yagr uniquement)
- Nœud custom N8N (option B abandonnée)
- Injection directe de credentials par API REST N8N (option A abandonnée comme solution principale)

---

## Fichiers concernés (estimation)

| Fichier | Action |
|---|---|
| `src/runtime/proxy-runtime.ts` | Étendre pour mode standalone |
| `src/tools/n8n/N8nCredentialSyncService.ts` | Créer |
| `src/tools/n8n/N8nLlmCredentialOrchestrator.ts` | Créer |
| `src/prompt/n8n-workflow-setup.ts` (ou équivalent) | Mettre à jour système prompt |
| `~/.yagr/n8n-proxy-consent.json` | Fichier runtime (consentement versionné) |
