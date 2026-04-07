# UX — Scroll naturel + opérations collapsibles

## Problème avec l'approche Ctrl+Y

L'approche actuelle de la TUI utilise un mode "historyOpen" (Ctrl+Y) qui swipe toute l'interface
vers une vue texte plate de l'historique. Ce n'est pas la bonne direction :
- c'est un mode global, pas une interaction sur un item individuel
- l'interface "normale" ne montre que les dernières 6 opérations
- l'utilisateur doit basculer de mode pour lire ce qui s'est passé

Claude Code et les outils modernes font différemment : le scroll classique est suffisant.
Les opérations (exécutions de commandes, thinking) sont collapsées par défaut
et le terminal gère le scrollback naturellement.

## Nouvelle direction

### TUI

**Avant :**
- 2 panels fixes (stage + prompt)
- Ctrl+Y bascule vers un mode "history" plein écran
- Operations affichées seulement pendant le run actif, coupées à 6

**Après :**
- Feed passé rendu avec `<Static>` de Ink (persiste dans le scroll buffer terminal)
- Section dynamique bas d'écran : opérations live + texte live + prompt
- Pas de mode global : l'utilisateur scrolle vers le haut pour voir l'historique
- Toutes les opérations visibles (pas de slice -6)
- Operations collapsées par défaut (titre + résumé court), auto-expanded si running
- Ctrl+Y et /history supprimés

**Contenu de la Static section (scroll buffer) :**
```
[14:23]  You      · "Crée un workflow qui envoie un email chaque matin"
[14:23]  Result   · "Workflow deployé — https://..."
[14:25]  You      · "Ajoute une condition si c'est le weekend"
...
```

**Contenu de la section dynamique (bottom, in-place) :**
```
◐  Inspect (phase)
●  Read: package.json                0.1s
●  Shell: npm install               2.3s
◐  Write: workflow.json  ← running...
  › stream live assistant text here
╭─ Prompt ──────────────
│  ◐ Writing workflow.json…
│  › _
╰──────────────────────
```

**Raccourcis conservés :**
- `Ctrl+C` : quitter
- `Ctrl+O` : ouvrir workflow dans le browser
- `Ctrl+X` : expand/collapse la dernière opération terminée (optionnel, futur)

**Raccourcis supprimés :**
- `Ctrl+Y` : remplacé par le scroll terminal naturel
- `/history`, `/toggle-history` : supprimés

### WebUI

**Avant :**
- `operationEntries.slice(-6)` : 6 ops max visible
- Les opérations disparaissent une fois le streaming terminé
- `showProgress = streaming || failed_terminal` : pas montré sur messages finaux

**Après :**
- Toutes les opérations visibles sur chaque message (pas de limite)
- Opérations collapsées par défaut, expand au click (déjà implémenté via OperationCard)
- Thinking ops collapsées et visuellement distinctes (opacity réduite)
- Opérations persistantes sur les messages finaux (pas seulement pendant streaming)
- `showOperations = operationEntries.length > 0` (indépendant de streaming)

**UX OperationCard WebUI (déjà en place, à améliorer) :**
```
▼  🐚  Shell: npm install                      ✓   2.3s   ▲
   stdout
   ...output...
   exit 0
```

**Améliorations CSS :**
- `operationCard` : border-radius plus doux, gap entre icône et label
- Thinking card : opacity 0.6, italic label
- Running card : border pulse animation
- Body code : font-family mono, line-height confortable
- `opBody` max-height avec scroll interne si très long

## Implémentation

### Fichiers touchés
- `src/gateway/interactive-ui.tsx` (TUI refactor)
- `src/webui/app.tsx` (WebUI: enlever slice, showProgress, OperationCard defaults)
- `src/webui/styles.css` (improvements)

### Non-régressif
- `YagrOperationEvent` type inchangé
- `feed` entries (user/result/interrupt) inchangés
- `pushEntry` inchangé
- WebUI SSE protocol inchangé
