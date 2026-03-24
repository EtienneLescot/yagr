# Architecture Dossier

Ce dossier est le point d'entree de la documentation architecturale du repo.

Il est volontairement scinde en deux zones:

- `current/`: documentation durable de l'architecture actuelle du codebase
- `target/`: documentation ephemere reduite au backlog restant

## Regles de maintenance

### `current/`

Cette partie est durable.

Elle doit:

- decrire ce qui existe vraiment dans le repo
- etre mise a jour a chaque changement structurel important
- rester factuelle
- contenir des graphes et des cartes de circulation utiles

Elle ne doit pas:

- decrire un ideal futur comme s'il existait deja
- cacher les zones floues ou les couplages actuels

### `target/`

Cette partie est ephemere.

Elle doit:

- contenir uniquement le backlog restant
- rester minimale et rapidement supprimable

Elle doit etre reduite puis supprimee au fur et a mesure:

- quand une cible devient realite, elle est migree dans `current/`
- quand un chantier n'est plus pertinent, il est retire
- quand toute la convergence est terminee, `target/` peut disparaitre

## Structure

```text
architecture/
├── README.md
├── current/
│   ├── README.md
│   ├── system-overview.md
│   ├── module-map.md
│   └── runtime-flows.md
└── target/
    └── backlog.md
```

## Usage attendu

Ordre de lecture recommande:

1. `current/system-overview.md`
2. `current/module-map.md`
3. `current/runtime-flows.md`
4. `target/backlog.md`
