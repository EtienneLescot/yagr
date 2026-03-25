# AGENT.md

Ce fichier decrit les regles de travail et les bonnes pratiques a respecter dans ce repo.

Il complete la documentation architecturale situee dans [architecture/README.md](./architecture/README.md).

Avant tout changement structurel, lire en priorite:

1. [architecture/current/system-overview.md](./architecture/current/system-overview.md)
2. [architecture/current/module-map.md](./architecture/current/module-map.md)
3. [architecture/current/runtime-flows.md](./architecture/current/runtime-flows.md)
4. [architecture/target/backlog.md](./architecture/target/backlog.md)

## Principes directeurs

- Garder le code propre, maintenable dans la duree, simple et resilient.
- Ne pas reinventer la roue sans raison solide.
- Favoriser la clean architecture et des frontieres explicites entre couches.
- Respecter le SSOT partout.
- Eviter le code eparpille et la duplication de logique.
- Faire des abstractions seulement lorsqu'elles clarifient vraiment les responsabilites.

## Regles d'architecture

### 1. Responsabilites nettes

Chaque bloc doit avoir une responsabilite principale claire.

En particulier:

- la boucle agentique ne doit pas absorber la logique de facade
- les facades ne doivent pas devenir le cerveau du produit
- le setup ne doit pas se disperser dans plusieurs surfaces
- la couche provider ne doit pas absorber la logique de haut niveau du tooling

### 2. SSOT obligatoire

Toute logique structurelle doit avoir une source d'autorite claire.

Exemples:

- un calcul de chemin ne doit pas etre recopie dans plusieurs modules
- une regle de config ne doit pas etre reimplementee dans le wizard, la WebUI et une gateway
- une politique provider ne doit pas exister a moitie dans le runtime et a moitie dans le provider

Si un comportement doit exister a plusieurs endroits, il faut l'extraire plutot que le recopier.

### 3. Providers LLM fins et plugins

La direction cible du repo est:

- une couche standard de providers LLM
- des providers ajoutes comme plugins
- une couche logique provider la plus fine possible

Chaque provider doit contenir uniquement:

- sa configuration propre
- sa factory de modele
- ses mecanismes d'auth/session
- ses specificites strictement necessaires

La logique commune ne doit pas etre repoussee dans chaque provider.

### 4. Interface tooling/providers explicite

L'interface entre tooling et providers doit etre forte, lisible et centralisee.

Le repo doit pouvoir gerer plusieurs niveaux de capacites providers en tooling:

- providers forts avec tool calling natif
- providers partiellement compatibles
- providers faibles ou a fallback

Cette harmonisation doit se faire dans une couche rationnelle commune, pas par empilement d'exceptions dans chaque provider.

### 5. Facades minces

TUI, WebUI, Telegram, CLI et futures surfaces doivent rester minces.

Elles doivent principalement:

- recevoir des inputs
- appeler les services adequats
- rendre les outputs et les evenements

Elles ne doivent pas concentrer:

- la logique de configuration
- la logique de setup
- la logique provider
- la logique coeur metier

### 6. Setup coherent

Le setup, le wizard et le bootstrap n8n doivent converger vers des services de setup uniques.

Il ne faut pas dupliquer la logique d'onboarding entre:

- le wizard
- la WebUI
- d'autres surfaces

### 7. Orchestrateur et backend automation

Yagr reste au-dessus de l'orchestrateur.

- n8n est le backend principal aujourd'hui
- le coeur agentique ne doit pas etre noye dans les details d'integration n8n
- les contrats backend doivent rester propres et evolutifs

## Regles de maintenance documentaire

### Architecture actuelle

Le dossier `architecture/current/` doit toujours decrire le repo tel qu'il existe vraiment.

Il faut le mettre a jour des qu'un changement modifie:

- les responsabilites d'un module
- les flux transverses
- les dependances structurelles entre blocs
- la place d'un composant dans l'architecture

### Architecture cible

Le dossier `architecture/target/` est ephemere.

Il sert a:

- suivre uniquement le travail restant

Il doit etre nettoye au fur et a mesure:

- quand une cible devient reelle, elle est decrite dans `architecture/current/`
- les items termines doivent disparaitre du backlog cible
- la documentation cible obsolete doit etre supprimee

## Reflexes attendus avant de coder

- identifier le bloc logique concerne
- verifier s'il existe deja un SSOT
- verifier si une logique similaire existe deja ailleurs
- verifier si le changement renforce ou detruit une frontiere architecturale
- mettre a jour la documentation architecturale si la structure change

## Signaux d'alerte

Un changement doit etre reconsidere si:

- il duplique une logique deja presente ailleurs
- il ajoute une exception provider-specific dans une couche generique sans necessite forte
- il deplace de la logique coeur dans une facade
- il ajoute un couplage transverse non documente
- il rend plus difficile la future evolution vers une architecture plugin propre

## Regle pratique

Quand un doute existe entre:

- ajouter vite une nouvelle couche ad hoc
- ou clarifier la responsabilite et extraire un point d'autorite

il faut preferer la clarification et le point d'autorite.
