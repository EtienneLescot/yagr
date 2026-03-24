# Target Backlog

Cette section est ephemere.

Elle doit contenir uniquement le travail restant pour converger vers une architecture propre et stable.
Tout ce qui est deja implemente doit etre documente dans `../current/`, pas ici.

## Restant a faire

| Status | Theme | Remaining work | Expected outcome |
| --- | --- | --- | --- |
| `in-progress` | Setup SSOT | Finir d'extraire les duplications restantes entre `src/setup.ts`, `src/gateway/webui.ts` et les autres facades | Une couche applicative unique pilote setup/configuration |
| `in-progress` | Providers | Continuer d'amincir les adapters autour du contrat `ProviderPlugin` | Les providers ne gardent que auth, transport et conversion minimale |
| `in-progress` | Tooling | Formaliser davantage l'interface tooling/providers et durcir le chemin `none` | La strategie `native / compatible / weak / none` devient pleinement systematique |
| `todo` | Google Proxy | Requalifier `google-proxy` puis decider refonte propre ou suppression | Pas de provider ambigu qui degrade Gemini |
| `todo` | Engine ports | Decouper l'interface `Engine` en ports plus fins | Backend plus composable et responsabilites mieux separees |
| `todo` | Facades | Amincir Telegram/WebUI/TUI/CLI | Facades reduites a I/O, session et orchestration legere |
| `todo` | Current docs | Continuer a mettre `architecture/current/` a jour a chaque refactor structurel | La doc durable reste le reflet exact du repo |

## Regle de vie

- Quand un item est termine, il est retire de cette page.
- Quand une nouvelle realite architecturale existe, elle est documentee dans `../current/`.
- `target/` doit rester minimal; si tout est convergé, ce dossier peut disparaitre.
