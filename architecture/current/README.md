# Current Architecture

Cette section documente l'architecture actuelle du repo.

Elle doit toujours refleter le code tel qu'il existe maintenant.

## Contenu

- `system-overview.md`: vue d'ensemble des grands blocs logiques, incluant la doctrine d'outillage (trois couches)
- `module-map.md`: cartographie plus fine par dossier et responsabilites
- `runtime-flows.md`: flux transverses importants
- `n8n-local.md`: architecture actuelle du bootstrap n8n local et de sa strategie de test
- `tui-ux.md`: principes durables de l'UX agentique TUI

Les trois pages principales doivent rester coherentes entre elles:

- `system-overview.md` montre les couches, les frontieres et les principes directeurs (dont la doctrine d'outillage)
- `module-map.md` montre ou vivent concretement les modules
- `runtime-flows.md` montre comment les appels traversent ces couches

## Convention

Quand une responsabilite change, il faut mettre a jour:

- le graphe concerne
- le texte de responsabilite
- les references de fichiers principales

Si une page ne reflete plus le code reel, elle est consideree comme obsolete et doit etre corrigee rapidement.
