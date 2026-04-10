# Current Architecture

Cette section documente l'architecture actuelle du repo.

Elle doit toujours refleter le code tel qu'il existe maintenant.

## Contenu

- `system-overview.md`: vue d'ensemble des grands blocs logiques actuels
- `deepagents-agent.md`: architecture de l'agent Deepagents actuellement compose dans Yagr
- `deepagents-coding-layer.md`: frontiere explicite entre le socle Deepagents pristine et la surcouche coding-oriented
- `module-map.md`: cartographie plus fine par dossier et responsabilites
- `runtime-flows.md`: flux transverses importants
- `n8n-local.md`: architecture actuelle du bootstrap n8n local et de ses services associes
- `tui-ux.md`: principes durables de l'UX agentique TUI

Les pages principales doivent rester coherentes entre elles:

- `system-overview.md` montre les couches et les frontieres
- `deepagents-agent.md` montre la composition exacte de l'agent runtime
- `deepagents-coding-layer.md` montre la frontiere stricte entre `pristine` et la surcouche `coding-oriented`
- `module-map.md` montre ou vivent concretement les modules
- `runtime-flows.md` montre comment les appels traversent ces couches

## Convention

Pour les fichiers d'instructions runtime, la convention Yagr a retenir est:

- `AGENTS.md` est le format canonique pour la home Yagr et les workspaces geres.
- `AGENT.md` reste supporte pour compatibilite, mais ce n'est pas le nom a privilegier pour la home/runtime Yagr.

Pour le contrat de chemins runtime, la convention Yagr a retenir est:

- le backend principal est host-native: le cwd de l'agent est la home Yagr reelle sur la machine de l'utilisateur
- les chemins relatifs sont resolus a partir de cette home Yagr reelle
- les chemins absolus (`/foo/bar`) designent le vrai filesystem de l'hote, jamais un faux root virtuel Yagr
- `n8n-workspace` est un sous-dossier metier de la home Yagr; on y accede normalement via `n8n-workspace/...` ou `./n8n-workspace/...`

Quand une responsabilite change, il faut mettre a jour:

- le graphe concerne
- le texte de responsabilite
- les references de fichiers principales

Si une page ne reflete plus le code reel, elle est consideree comme obsolete et doit etre corrigee rapidement.
