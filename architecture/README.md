# Architecture Dossier

Ce dossier est le point d'entree de la documentation architecturale du repo.

Il est volontairement scinde en deux zones:

- `current/`: documentation durable de l'architecture actuelle du codebase
- `target/`: documentation ephemere de l'architecture cible et du chemin pour y parvenir

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

- decrire la cible architecturale
- lister les ecarts entre l'existant et la cible
- suivre le backlog de convergence

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
    ├── README.md
    ├── architecture-target.md
    └── refactor-backlog.md
```

## Usage attendu

Ordre de lecture recommande:

1. `current/system-overview.md`
2. `current/module-map.md`
3. `current/runtime-flows.md`
4. `target/architecture-target.md`
5. `target/refactor-backlog.md`
6. `target/provider-capability-implementation-plan.md`
