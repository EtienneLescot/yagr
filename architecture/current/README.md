# Current Architecture

Cette section documente l'architecture actuelle du repo.

Elle doit toujours refleter le code tel qu'il existe maintenant.

## Contenu

- `system-overview.md`: vue d'ensemble des grands blocs logiques, incluant la doctrine d'outillage (trois couches) et l'exposition Cloudflare Tunnel
- `module-map.md`: cartographie plus fine par dossier et responsabilites
- `runtime-flows.md`: flux transverses importants, dont le flux Cloudflare Tunnel
- `n8n-local.md`: architecture actuelle du bootstrap n8n local, de sa strategie de test et du module Cloudflare Tunnel
- `tui-ux.md`: principes durables de l'UX agentique TUI

Les trois pages principales doivent rester coherentes entre elles:

- `system-overview.md` montre les couches, les frontieres et les principes directeurs (dont la doctrine d'outillage)
- `module-map.md` montre ou vivent concretement les modules
- `runtime-flows.md` montre comment les appels traversent ces couches

## Convention

Pour les fichiers d'instructions runtime, la convention Yagr a retenir est:

- `AGENTS.md` est le format canonique pour la home Yagr et les workspaces geres.
- `AGENT.md` reste supporte pour compatibilite et pour certains repos existants, mais ce n'est pas le nom a privilegier pour la home/runtime Yagr.

Quand une responsabilite change, il faut mettre a jour:

- le graphe concerne
- le texte de responsabilite
- les references de fichiers principales

Si une page ne reflete plus le code reel, elle est consideree comme obsolete et doit etre corrigee rapidement.
