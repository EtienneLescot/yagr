# Refactor Backlog

Cette page suit le travail restant pour converger vers l'architecture cible.

Statuts utilises:

- `todo`
- `in-progress`
- `done`
- `dropped`

Quand un item passe a `done`, il doit etre retire rapidement de cette page et la doc descriptive correspondante doit etre consolidee dans `../current/`.

## Backlog

| Status | Theme | Item | Outcome attendu |
| --- | --- | --- | --- |
| `in-progress` | Setup SSOT | Extraire des services applicatifs communs a partir de `src/setup.ts` et `src/gateway/webui.ts` | Une partie du chemin commun existe dans `src/setup/application-services.ts`, a poursuivre jusqu'a suppression des duplications restantes |
| `in-progress` | Providers | Introduire une resolution `metadata -> normalisation -> strategie runtime` | Le resolver, le cache metadata et la strategie runtime commune existent, a etendre encore aux metadata dynamiques multi-providers et aux adapters fins |
| `todo` | Providers | Introduire un contrat `ProviderPlugin` avec adapters fins | Providers plus fins, logique commune centralisee |
| `in-progress` | Tooling | Introduire une vraie strategie runtime `native / compatible / weak / none` | Le runtime commun pilote deja les modes principaux; il reste a mieux formaliser le contrat tooling/providers et le chemin `none` |
| `in-progress` | OpenRouter | Brancher les metadonnees dynamiques OpenRouter (`models`, `endpoints`, `supported_parameters`) | Le fetch `models` et la normalisation existent; il reste a enrichir avec les endpoints et d'autres metadata fines |
| `todo` | Google Proxy | Requalifier `google-proxy` et decider refonte propre ou suppression | Pas de provider ambigu qui expose Gemini sans tool calling propre |
| `todo` | Engine ports | Decouper l'interface `Engine` en ports plus fins | Contrats plus propres et backend plus composable |
| `todo` | Facades | Amincir Telegram/WebUI/TUI/CLI | Facades reduites a I/O et orchestration de session |
| `todo` | Current docs | Completer progressivement `architecture/current/` au fil des refactors | Vision toujours a jour du repo |

## Ordre recommande

1. Extraire les services de setup/configuration
2. Mettre en place la resolution dynamique des capacites providers/modeles
3. Formaliser la strategie runtime tooling par niveau
4. Refondre la couche providers autour d'adapters fins
5. Decouper le contrat backend automation
6. Mettre a jour la documentation `current/` au fur et a mesure

## Definition of done documentaire

Un chantier n'est pas considere termine tant que:

- le code est refactorise
- la doc `current/` reflete la nouvelle realite
- l'item a disparu de cette page
