# Target Backlog

Cette section est ephemere.

Elle doit contenir uniquement le travail restant pour converger vers une architecture propre et stable.
Tout ce qui est deja implemente doit etre documente dans `../current/`, pas ici.

## Restant a faire

La direction cible de reference est documentee dans `yagr-engine-architecture.md`.

- Renommer et recadrer `holon` en `Yagr Engine`
- Formaliser un IR canonique distinct des backends cibles
- Integrer l'UI graphe AI-native de `Yagr Engine` dans les surfaces `Yagr`
- Faire de `Hatchet` le runtime du chemin `Yagr Engine`
- Formaliser le choix backend amont `n8n` vs `Yagr Engine + Hatchet`
- Extraire progressivement le couplage `n8n` encore present dans le prompt, le tooling et les flux de run
- Unifier les edits chat et UI autour du meme pipeline de patch/validation `Yagr Engine`

## Regle de vie

- Quand un item est termine, il est retire de cette page.
- Quand une nouvelle realite architecturale existe, elle est documentee dans `../current/`.
- `target/` doit rester minimal; si tout est converge, ce fichier ne comporte plus de todo.
