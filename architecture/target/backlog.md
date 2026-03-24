# Target Backlog

Cette section est ephemere.

Elle doit contenir uniquement le travail restant pour converger vers une architecture propre et stable.
Tout ce qui est deja implemente doit etre documente dans `../current/`, pas ici.

## Restant a faire

| Status | Theme | Objective de sortie | Definition de done |
| --- | --- | --- | --- |
| `in-progress` | Providers | Ramener les adapters providers au strict minimum autour de `ProviderPlugin` | Chaque adapter provider ne garde que auth, transport, conversion minimale et hooks metadata |
| `in-progress` | Tooling | Stabiliser le contrat commun tooling/providers pour `native / compatible / weak / none` | La strategie runtime choisit seule surface d'outils, mode d'execution et contraintes de tool calling |
| `todo` | Engine ports | Finir la migration hors du contrat `Engine` monolithique | Runtime, prompt et gateways ne dependent plus de `Engine` complet quand un port plus fin suffit |
| `todo` | Facades | Limiter les facades a l'I/O et a la session | Telegram/WebUI/TUI/CLI ne mutent plus directement la config metier et deleguent aux services applicatifs |
| `todo` | Google Proxy | A refondre proprement avec capacites explicites | `google-proxy` est refonddu proprement avec capacites explicites et les tests advanced passent |

## Regle de vie

- Quand un item est termine, il est retire de cette page.
- Quand une nouvelle realite architecturale existe, elle est documentee dans `../current/`.
- `target/` doit rester minimal; si tout est convergé, ce fichhier ne comporte plus de todo.
