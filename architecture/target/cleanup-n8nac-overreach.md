# Cleanup : retrait de la surcouche n8nac

## Principe directeur

Yagr se compose de deux couches distinctes :

### yagr-agent
Agent autonome générique — boucles agentiques, Vercel AI SDK, capacités de codage. Doit être **au niveau des meilleurs agents du marché** (Cursor, Copilot, Roo). Travaille avec n8nac exactement comme Cursor le ferait : lit le stdout brut, comprend les erreurs, choisit les bons arguments, itère. **Aucun code d'interprétation spécifique n8nac dans cette couche.**

### yagr-manager
Infrastructure différenciante de yagr — c'est ici que vit la valeur ajoutée :
- Lifecycle des instances n8n (installation, démarrage, managed/Docker/local)
- Manager de proxy LLM (relay, rotation de credentials)
- Tunneling Cloudflare (n8n + proxy)
- Surcouche UX légère : présentation des workflows (bannières `presentWorkflowResult`)

---

**Le cleanup en cours** : retirer de yagr-agent tout code qui soit (a) fait le travail du modèle à sa place, soit (b) appartient en réalité à yagr-manager.

Constat de départ : Roo, Cursor et Copilot travaillent parfaitement avec n8nac sans aucune ligne de code spécifique. Chaque couche d'interprétation ajoutée dans yagr-agent devient une surface de régression quand n8nac évolue.

---

## Ce qui doit être retiré

### 1. `src/tools/n8nac.ts` — code d'interprétation résiduel

| Élément | Raison du retrait |
|---|---|
| `detectWorkflowNodeMisconfigurations` + types `WorkflowNodeMisconfiguration` | Responsabilité de `n8nac validate` / `n8nac push`. Logique regex fragile sur du source TypeScript. Cassera à la prochaine évolution du DSL. |
| `normalizeCommandArgv` | Yagr devine quel fichier le modèle voulait. Le modèle doit passer le bon chemin — c'est son travail. |
| `resolveCommandFileTarget` | Idem. Découle de `normalizeCommandArgv`. |
| `pickPreferredWorkspaceWorkflowCandidate` | Idem. |
| `rankWorkspaceWorkflowCandidate` | Idem. |
| `normalizeWorkspaceRelativePath` (dans n8nac.ts) | Idem. |
| `getLlmProviderCatalog` | Liste hardcodée de providers LLM, stale à la prochaine release n8n/n8nac. |
| Action `llm_provider_options` | Découle du catalog. Si n8nac expose une commande pour ça, l'appeler directement. Sinon le modèle n'a pas besoin d'un menu pré-mâché. |
| `isWorkspaceInitialized` | Dead code : défini, jamais appelé depuis l'extérieur. |
| Pre-push validation block dans l'action `command` | Appelle `detectWorkflowNodeMisconfigurations`. Disparaît avec elle. |
| Les champs `operation`, `pushTarget`, `workflowId`, `workflowUrl`, `title`, `verified`, `misconfigurations` dans le return du pre-push | Retrait mécanique avec le bloc. |

**Ce qui reste dans n8nac.ts :**
- `runN8nac` / `runObservedN8nac` / `getN8nacProcessEnv` — plomberie d'exécution.
- `summarizeN8nacRuntime` — observabilité TUI, pas d'interprétation.
- Action `command` — retourne `stdout`/`stderr`/`exitCode`/`timedOut`/`argv` bruts + signal `asyncTrigger`.
- Action `yagr_proxy_relay_start` — manager LLM proxy légitime.

---

### 2. `src/prompt/build-system-prompt.ts` — règles trop spécifiques à n8nac

| Règle actuelle | Problème | Action |
|---|---|---|
| `lmChatOpenAi v1.3 node MANDATORY rules` (responsesApiEnabled, model mode "id") | Règle de configuration d'un nœud n8n précis. Appartient à la doc n8nac ou à un AGENT.md workspace, pas au prompt système de yagr. | Retirer |
| `For LLM credential setup... use n8nac action llm_provider_options` | Référence une action qu'on supprime. | Retirer avec l'action |
| `Before asking for new LLM secrets, call n8nac credential list --json` | Régie comportementale n8nac fine. Un bon AGENT.md workspace suffit. | Retirer (déplacer dans un AGENT.md template si besoin) |

**Ce qui reste dans le prompt système :**
- La règle "greeter court sans appel tool" — règle UX générique.
- La règle "n8n operations via n8nac" — règle d'architecture, pas d'implémentation.
- L'injection de `workflowDir`, `n8nHost`, `n8nTunnelPublicUrl` — données d'infrastructure, légitimes.
- La règle "green status ≠ correct, inspecter les downstream nodes" — règle d'agentique générale.
- Les règles "ground in tool outputs" et "correct stale assumptions" — règles d'agentique générales.
- Les règles workspace AGENT.md — règle d'architecture.

---

### 3. Tests à supprimer avec le code

| Fichier | Tests concernés |
|---|---|
| `tests/n8nac-tool.test.mjs` | Toute la suite `pickPreferredWorkspaceWorkflowCandidate` (ligne ~333) |
| `tests/n8nac-tool.test.mjs` | Toute la suite `detectWorkflowNodeMisconfigurations` (lignes ~416–475) |
| `tests/n8nac-tool.test.mjs` | Tests de l'action `llm_provider_options` si présents |

---

## Séparation yagr-agent / yagr-manager (réflexion ouverte)

La séparation conceptuelle décrite ci-dessus existe déjà mentalement. Elle pourrait devenir une séparation physique si yagr-agent ne tient pas la comparaison avec les agents du marché.

Dans ce scénario, yagr-manager deviendrait un **daemon d'infrastructure autonome** (n8n lifecycle + LLM proxy + tunnels) pluggable sur n'importe quel agent via une interface standard (MCP server ou API locale). L'utilisateur choisirait son agent (Cursor, Roo, OpenHands…) et yagr-manager fournirait l'infrastructure en dessous.

Ce n'est pas une priorité immédiate. À documenter dans `yagr-engine-architecture.md` quand la décision est prise.

---

## Règle de vie

Les items ci-dessus sont retirés un par un, avec un build propre après chaque étape.
Quand un item est terminé, il est rayé de cette liste.
Quand tout est terminé, ce fichier est archivé dans `../current/`.
