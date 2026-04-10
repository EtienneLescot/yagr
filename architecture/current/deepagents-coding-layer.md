# Deepagents Pristine And Coding Overlay

Cette page documente la separation voulue et actuelle entre:

- le socle deepagentsjs le plus `pristine` possible
- la surcouche Yagr `coding-oriented`, agnostique mais orientee agent de codage

## Frontiere physique

Les fichiers de reference sont:

- `src/deepagents/pristine.ts`
- `src/deepagents/coding-orientation.ts`
- `src/agent-factory.ts`

La regle est volontairement simple:

- `src/deepagents/pristine.ts` ne contient que l'assemblage deepagentsjs natif commun: backend, memory sources, config de base
- `src/deepagents/coding-orientation.ts` porte la surcouche explicite et optionnelle, implementee uniquement via middleware deepagents/LangChain
- `src/agent-factory.ts` est le point de composition. Il assemble `pristine + overlay`, mais ne doit pas melanger leurs responsabilites

## Couche 1: deepagentsjs pristine

Le socle pristine se limite a:

- `LocalShellBackend` host-native
- `memory: ['/AGENTS.md', '/n8n-workspace/AGENTS.md']`
- `MemorySaver` comme checkpointer de session
- le modele LangChain resolu par Yagr

Invariants:

- pas de prompt runtime Yagr custom dans cette couche
- pas de tools runtime Yagr custom injectes dans cette couche
- pas de regles metier n8n ou manager dans cette couche
- pas d'hypothese de faux root virtuel

## Couche 2: surcouche coding-oriented

La surcouche actuelle est volontairement minimale et agnostique.

Elle vit dans `src/deepagents/coding-orientation.ts` et ajoute un middleware unique:

- `YagrCodingOrientationMiddleware`

Cette surcouche:

- n'ajoute aucun tool custom
- n'ajoute aucune regle n8n specifique
- n'ajoute aucune logique manager
- n'introduit qu'une orientation generique d'agent de codage

Le mecanisme retenu est celui recommande par deepagentsjs pour ce type de personnalisation:

- middleware `wrapModelCall`
- ajout d'un `SystemMessage` supplementaire

## Point de composition

`src/agent-factory.ts` compose explicitement les deux couches:

1. construit le modele LangChain
2. construit le checkpointer
3. applique `buildPristineDeepAgentConfig(...)`
4. ajoute `middleware: getCodingOrientedDeepAgentMiddleware()`
5. instancie `createDeepAgent(...)`

Cette composition doit rester visible dans le code. Si une future evolution n'est ni clairement `pristine`, ni clairement `coding-oriented`, elle doit etre refusee ou isolee dans une troisieme couche nommee.

## Ce qui n'est plus accepte

Pour eviter les regressions structurelles, les ajouts suivants ne doivent pas revenir dans le coeur agent:

- fichier de `system prompt` runtime Yagr monolithique
- injection de tools Yagr generiques dans le deep-agent principal
- memoire cross-session injectee artisanalement dans le prompt runtime
- regles manager ou n8n codees dans le coeur agent

## Critere d'evolution

Avant d'ajouter une nouvelle surcouche, il faut pouvoir repondre clairement:

1. Est-ce que deepagentsjs pristine ne sait vraiment pas deja le faire proprement ?
2. Est-ce que l'extension utilise un point d'extension natif deepagentsjs ou LangChain ?
3. Peut-on la placer dans un fichier de surcouche explicite sans contaminer `pristine.ts` ?
4. Peut-on decrire cette extension comme agnostique et non metier ?

Si la reponse est non a l'une de ces questions, l'ajout ne doit pas aller dans le coeur agent.