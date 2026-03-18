# Handover — Session du 17 mars 2026

## Objectif de la session

Trois objectifs enchaînés :

1. **Réparation visuelle de la homepage Yagr** (contraste, couleurs résiduelles, structure CSS)
2. **Backport CLI vers `next`** de deux correctifs de qualité identifiés par diff
3. **Split de repo** : extraction de Yagr en dépôt standalone `EtienneLescot/yagr`

---

## 1. Réparation visuelle de la homepage Yagr

### Contexte

La homepage Yagr (`docs/src/pages/index.tsx` + `index.module.css`) avait plusieurs problèmes :
- Du rose résiduel visible (glow de l'ancienne palette n8n-as-code)
- Des sections invisibles (bouton "Start with Yagr" transparent)
- La grille héro ne se repliait pas correctement sur les largeurs intermédiaires
- Un bloc "Quick Start" redondant dupliquait les commandes déjà présentes dans la hero
- Le titre CTA "Start from the Yagr vision…" était illisible (foncé sur fond foncé)

### Corrections appliquées à `docs/src/pages/index.module.css`

| Problème | Cause racine | Fix |
|---|---|---|
| Rose résiduel | `.heroBanner::after` avait un `rgba(255,59,122,0.12)` global | `.yagrHeroBanner::after { background: rgba(128,187,199,0.16) }` |
| Bouton invisible | Variables CSS palette déclarées uniquement sur `main.yagrHome`, mais la hero est un `<header>` | Étendu à `.yagrHome, .yagrHeroBanner { --yagr-*: … }` |
| CSS corrompu | Des sélecteurs imbriqués illégaux dans `.heroBanner :global(.container)` cassaient le parse | Supprimés et restaurés proprement |
| Grille héro tardive | `.heroGrid` restait en 2 colonnes jusqu'à 996px | `@media (max-width: 1180px) .yagrHeroBanner .heroGrid { grid-template-columns: 1fr }` |
| Badge illisible | `color: var(--yagr-cyan)` trop pâle sur fond ice | Split : `color: var(--yagr-night)` pour les badges |
| Titre CTA invisible | `color: var(--yagr-night)` (`#0d1020`) sur fond navy CTA | `color: #b8ecef` |

### Modifications à `docs/src/pages/index.tsx`

- Suppression du bloc terminal "Quick Start" (dark panel avec les commandes npm/npx) qui dupliquait le contenu hero
- Remplacement par une carte blanche légère avec un bouton primaire "Open the getting started guide" + lien "See all CLI commands"

### Palette Yagr de référence

```
--yagr-night / --yagr-night-deep : #0d1020
--yagr-ice                       : #b8ecef
--yagr-cyan / --yagr-steel       : #80bbc7
--yagr-slate                     : #456874
```

> **Point d'attention** : Les variables CSS doivent être déclarées **à la fois sur `.yagrHome` et `.yagrHeroBanner`** car la hero est un élément `<header>` frère de `<main class="yagrHome">`, pas un enfant.

---

## 2. Backport CLI vers `next`

### Diff analysée

```
471d869ed446d5eed1660cd8863daf1d7b3ccb86 → d3e9b93dbe9437a9a3619420d78388944ccbc740
```

Sur 104 fichiers modifiés dans cette plage, **seuls 2 fichiers sont hors scope Yagr** et méritaient un backport :

- `packages/cli/src/core/services/n8n-api-client.ts`
- `packages/cli/src/core/services/workflow-state-tracker.ts`

Les autres changements hors-Yagr (`.github/workflows/release.yml`, `scripts/check-version-consistency.js`, `scripts/release/workspace-release.mjs`) n'ajoutent que l'entrée `yagr` dans des listes — rien de générique à n8n-as-code.

### Commit cherry-pické

```
bcf4e02  fix(cli): suppress API warning spam in n8nac list output
```

**Nature des corrections :**
1. **Race condition** dans `getProjectsCache()` : ajout d'un `projectsCachePromise` pour dédupliquer les appels API concurrents (ex. `Promise.all` sur N workflows déclenchait N fois l'appel `/projects` et N fois le warning de licence)
2. **Debug log gating** : tous les `console.debug()` inconditionnels passés en `if (process.env.DEBUG) console.debug(...)` dans les deux fichiers

### Branche créée

```
fix/cli-debug-log-spam  ←  origin/next  +  cherry-pick bcf4e02
```

Poussée sur `origin` (`EtienneLescot/n8n-as-code`). **Une PR est à ouvrir** : `fix/cli-debug-log-spam → next`.

---

## 3. Split de repo — Yagr standalone

### Décision

Yagr devient son propre dépôt GitHub indépendant. Les dépendances cross-package (`@n8n-as-code/skills`, `@n8n-as-code/transformer`, `n8nac`) sont déjà toutes publiées sur npm et référencées dans `packages/yagr/package.json` — aucun changement de code source requis.

**Versions publiées confirmées au moment du split :**
- `@n8n-as-code/skills@1.1.3`
- `@n8n-as-code/transformer@1.0.2`
- `n8nac@1.1.3`

### Remotes en place

```
origin  git@github.com:EtienneLescot/n8n-as-code.git   (inchangé)
yagr    git@github.com:EtienneLescot/yagr.git           (ajouté)
```

### Branche de travail

```
feat/yagr-standalone  (locale + poussée comme main sur yagr remote)
```

### Commit de nettoyage

```
d2119d4  feat: standalone Yagr repo — remove n8n-as-code packages, docs and tooling
```

### Ce qui a été supprimé

| Catégorie | Éléments supprimés |
|---|---|
| Packages | `packages/cli`, `packages/skills`, `packages/transformer`, `packages/vscode-extension` |
| Plugins | `plugins/` entier |
| Docs n8n-as-code | `docs/docs/`, `docs/refactoring/`, `docs/sidebars.ts`, `docs/sidebars.api.ts`, `docs/src/pages/n8n-as-code.tsx` |
| Plans | `plans/MANUAL_TESTING.md`, `plans/PHASE_2_COMPLETE.md`, `plans/TYPESCRIPT_TRANSFORMER_PLAN.md` |
| Products | `products/` entier |
| Scripts n8n-as-code | `scripts/build-*`, `scripts/download-*`, `scripts/ensure-*`, `scripts/generate-*`, `scripts/enrich-*`, `scripts/compare-*`, `scripts/setup-*`, etc. |
| Racine | `test-ai-connections.mjs`, `test-hash-stability.mjs`, `test-watcher-detection.mjs`, `typedoc.json`, `.tmp-index-module-head.css`, `CLAUDE_PLUGIN_SUBMISSION_DRAFT.md` |

### Ce qui a été modifié

| Fichier | Nature du changement |
|---|---|
| `package.json` (racine) | Réécrit : workspace `["packages/yagr"]` seul, bin `yagr`, scripts Yagr uniquement |
| `tsconfig.json` (racine) | Une seule référence : `packages/yagr` |
| `packages/yagr/tsconfig.json` | Suppression des références `../skills`, `../transformer`, `../cli` |
| `packages/yagr/package.json` | URL repo → `https://github.com/EtienneLescot/yagr` |
| `release-please-config.json` | Package `yagr` uniquement |
| `scripts/check-version-consistency.js` | Yagr uniquement |
| `scripts/release/workspace-release.mjs` | PACKAGES, CROSS_PACKAGE_RULES, extensionPackage nettoyés pour Yagr seul |
| `docs/docusaurus.config.ts` | Nav/footer/preset Yagr-only, GitHub → `EtienneLescot/yagr`, preset docs → `yagr-docs/` |
| `docs/yagr-docs/index.md` | Liens `/n8n-as-code` → `https://n8nascode.dev` |
| `docs/yagr-docs/usage/n8n-backend.md` | Liens `/n8n-as-code` et `/docs` → externe |
| `docs/src/pages/index.tsx` | Liens `/n8n-as-code` → `https://n8nascode.dev` (boutons hero + CTA) |

### État final du repo Yagr standalone

```
packages/
  yagr/           ← seul package restant
scripts/
  check-version-consistency.js
  promote-next-to-main.mjs
  release/
  set-version-if-needed.mjs
  sync-brand-assets.mjs
  yagr-test-workspace.mjs
plans/
  holon-tui-agentic-ux.md
  yagr-runtime-roadmap.md
  yagr-tui-agentic-ux.md
docs/
  yagr-docs/      ← seule documentation
  src/pages/
    index.tsx     ← homepage Yagr
```

Le build Docusaurus passe **sans aucun lien cassé**.

---

## État des branches

### Repo `EtienneLescot/n8n-as-code`

| Branche | État | Action restante |
|---|---|---|
| `main` | Inchangé | — |
| `next` | Inchangé | — |
| `feat/agent-layer` | Branche d'origine du travail Yagr | PR éventuelle ou archivage |
| `feat/yagr-standalone` | HEAD local, commit `d2119d4` | **Non poussé sur origin** (volontaire) |
| `fix/cli-debug-log-spam` | Poussé sur origin | **PR à ouvrir** : `fix/cli-debug-log-spam → next` |

### Repo `EtienneLescot/yagr`

| Branche | État |
|---|---|
| `main` | Initialisé depuis `feat/yagr-standalone`, commit `d2119d4` |

---

## Actions restantes

1. **Ouvrir une PR** sur `EtienneLescot/n8n-as-code` : `fix/cli-debug-log-spam → next`
2. **Configurer le CI** du repo `yagr` (`.github/workflows/release.yml` à nettoyer des entrées n8n-as-code)
3. **Mettre à jour les dépendances Yagr** (`packages/yagr/package.json`) vers les dernières versions publiées de `@n8n-as-code/skills`, `@n8n-as-code/transformer`, `n8nac` si des nouvelles versions sont sorties depuis le freeze
4. **Configurer `CNAME`** dans `docs/static/CNAME` pour le domaine Yagr (`yagr.dev`)
5. **GitHub Pages** : activer sur le repo `yagr` en pointant sur le répertoire `/docs` ou une action de déploiement

---

## Commandes utiles

```bash
# Travailler sur la homepage Yagr
cd docs && npm start

# Valider le build docs
npm run docs:build

# Démarrer Yagr en mode test
npm run yagr:onboard
npm run yagr:start

# Vérifier cohérence des versions
npm run check-versions

# Préparer une release
npm run release:plan
```
