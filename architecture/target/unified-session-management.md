# Unified Session Management And Slash Commands

## Objectif

Mettre en place un management unifie des sessions de conversation dans le TUI, la WebUI et Telegram, avec une taxonomie unique des commandes slash et un point d'autorite unique pour les operations de session et de checkpoint.

Le resultat cible doit satisfaire les contraintes suivantes:

- `SessionService` reste le SSOT du cycle de vie des sessions.
- la logique slash ne vit plus dans chaque facade.
- `/resume` reference les sessions de conversation, jamais les checkpoints.
- `/restore` est reserve a la restauration de checkpoints.
- `/help` liste les commandes disponibles avec leur description.
- TUI, WebUI et Telegram partagent le meme catalogue de commandes et la meme semantique metier.
- les facades restent minces et adaptent seulement l'I/O et le rendu.

## Probleme actuel

Etat observe dans le repo:

- TUI: parsing inline dans `src/gateway/interactive-ui.tsx` avec des `if` locaux.
- Telegram: commandes Telegraf inline dans `src/gateway/telegram.ts`.
- WebUI: actions sessions/checkpoints via API et UI, sans couche slash commune.
- `SessionService` gere deja les sessions et checkpoints, mais pas une UX browse/resume/delete exploitable uniformement par facade.
- `WebUiSessionRegistry` stocke un etat de presentation WebUI qui n'est pas reutilisable tel quel par TUI et Telegram.
- conflit semantique actuel: dans le TUI, `/resume` restaure un checkpoint, alors que l'attente produit est une reprise de session.

## Decisions de design

### 1. SSOT des commandes slash

Introduire une couche commune dediee, par exemple dans `src/conversation/`:

- `slash-command-types.ts`
- `slash-command-registry.ts`
- `slash-command-service.ts`
- `slash-command-render.ts` si necessaire pour formatter les sorties textuelles communes

Responsabilites de cette couche:

- parser une entree slash brute
- resoudre une commande canonique
- valider les arguments
- executer l'action metier via `SessionService` et services associes
- retourner un resultat structure, independant de la facade
- exposer le catalogue des commandes pour `/help`

Les facades ne doivent plus reimplementer:

- la liste des commandes
- leur description
- leurs alias
- leur semantique
- leur validation d'arguments

### 2. Taxonomie canonique des commandes

Ne pas garder une taxonomie implicite divergente entre surfaces. Introduire un vocabulaire canonique orienté domaines:

- `/help`
- `/sessions`
- `/resume <session_id>`
- `/delete <session_id>`
- `/new`
- `/reset`
- `/checkpoints`
- `/save`
- `/restore <checkpoint_id>`
- `/delete-checkpoint <checkpoint_id>`
- `/pending`
- `/approve`
- `/compact`
- `/open`
- `/toggle-thinking`
- `/toggle-cli`
- `/stop`
- `/exit`

Notes produit:

- `/resume` devient strictement "reprendre une session de conversation".
- `/restore` devient strictement "restaurer un checkpoint".
- `/help` doit decrire les commandes visibles dans la facade courante.
- `/sessions` doit lister les sessions de conversation avec identifiant, titre, statut actif/ferme, dates et eventuellement un marqueur de session active.

### 3. Capacites par facade

Le catalogue est partage, mais toutes les commandes ne sont pas forcement actionnables dans chaque surface. Le SSOT doit distinguer:

- commande canonique
- disponibilite par facade (`tui`, `webui`, `telegram`)
- description utilisateur par facade si necessaire
- forme de rendu attendue

Exemples:

- `/exit` est utile au TUI, pas a Telegram.
- `/toggle-cli` est utile au TUI, probablement inutile ailleurs.
- `/open` n'a de sens que sur les surfaces locales capables d'ouvrir une URL.

Le point important est que la decision de disponibilite doit vivre dans le registre commun, pas dans chaque facade.

### 4. SSOT des sessions browseables

`SessionService` doit devenir l'API autoritaire pour:

- lister les sessions d'un scope facade
- identifier la session active d'un scope
- creer une nouvelle session dans un scope
- reprendre une session existante dans un scope
- supprimer une session
- fermer ou archiver une session

API cible a ajouter ou clarifier dans `src/session/session-service.ts`:

- `listForScope(scope)` enrichi pour usage UI
- `getActiveForScope(scope)`
- `resumeForScope(scope, sessionId)`
- `createForScope(scope, options?)`
- `deleteForScope(scope, sessionId)` ou garde-fous equivalentes

Les operations ci-dessus doivent encapsuler la gestion de `activeByScopeKey` aujourd'hui cachee dans `DeepAgentSessionStore`.

### 5. Separation stricte sessions vs checkpoints

Conserver une difference nette entre:

- session: identite conversationnelle longue duree
- checkpoint: snapshot restaureable d'une session

Effets attendus:

- `/sessions` ne liste pas les checkpoints
- `/resume` ne touche pas aux checkpoints
- `/checkpoints` liste les checkpoints de la session active
- `/restore` restaure un checkpoint sur la session active
- `/save` cree un checkpoint de la session active

### 6. Reprise de session et realite runtime

Le repo persiste aujourd'hui les metadonnees de session mais pas necessairement tout l'etat runtime vivant au-dela du process, selon le checkpointer reel.

Travail a cadrer explicitement dans l'implementation:

- verifier si le checkpointer actif permet un resume cross-restart fiable
- si non, documenter clairement la limite et eviter une UX trompeuse
- si oui requis produit, remplacer le checkpointer volatile par une implementation durable ou aligner la persistance existante

Le codage ne doit pas laisser une commande `/resume` qui promet plus que le runtime ne garantit reellement.

## Architecture cible

### `src/session/`

Reste le SSOT du cycle de vie des sessions:

- metadata de session
- mapping scope -> session active
- creation / rotation / reprise / suppression
- checkpoints
- eventuelle recuperation de transcript partage si ce besoin est retenu

### `src/conversation/`

Nouvelle couche SSOT des commandes conversationnelles:

- parse
- registre de commandes
- dispatch
- resultats structures
- aide `/help`

### `src/gateway/`

Reste un adaptateur mince par surface:

- convertit une entree utilisateur en commande ou prompt normal
- appelle la couche `conversation/`
- rend les resultats dans le format de la surface
- gere les specifics de rendu et de navigation locale

### `src/webui/`

La WebUI doit se brancher sur le meme SSOT, meme si elle conserve des interactions par boutons. Les actions UI doivent appeler les memes primitives metier que les commandes slash.

## Plan de mise en oeuvre

### Lot 0. Cadrage et invariants

Objectif:

- figer le contrat des commandes et la semantique session/checkpoint avant toute implementation.

Travail:

- definir la liste canonique des commandes et alias toleres
- definir les surfaces supportees par commande
- definir les sorties structurees minimales
- definir les erreurs standardisees (`unknown_command`, `invalid_arguments`, `unsupported_in_surface`, `session_not_found`, `checkpoint_not_found`, etc.)

Livrables:

- types communs de commandes et resultats
- table de compatibilite TUI/WebUI/Telegram

Critere d'acceptation:

- une seule source enumere toutes les commandes supportees et leur semantique

### Lot 1. Renforcement du SSOT session

Objectif:

- rendre `SessionService` suffisant pour naviguer entre sessions par scope sans logique cachee dans les facades.

Travail:

- ajouter une primitive pour recuperer la session active d'un scope
- ajouter une primitive pour activer/reprendre une session existante dans un scope
- clarifier les comportements de creation et rotation
- ajouter les garde-fous pour la suppression de session active si necessaire
- enrichir les resumes listes avec `closedAt`, `scope`, `isActiveForScope` si utile

Fichiers probables:

- `src/session/session-service.ts`
- `src/session/deepagent-sessions.ts`
- `src/session/session-types.ts`

Critere d'acceptation:

- TUI et Telegram peuvent lister et reassigner la session active sans reimplementer la logique de scope

### Lot 2. Service commun de slash commands

Objectif:

- supprimer la logique de commande inline des facades.

Travail:

- creer un parser unique des commandes slash
- creer un registre de commandes avec metadonnees (`name`, `description`, `usage`, `surfaces`, `aliases`)
- implementer un dispatcher qui appelle `SessionService`, `CompactionService` et les adapters necessaires
- retourner des resultats structures, pas du texte brut uniquement
- implementer `/help` a partir du registre

Fichiers probables:

- `src/conversation/slash-command-types.ts`
- `src/conversation/slash-command-registry.ts`
- `src/conversation/slash-command-service.ts`
- `src/conversation/index.ts`

Critere d'acceptation:

- la liste de commandes n'est definie qu'une seule fois dans le repo

### Lot 3. Migration TUI

Objectif:

- faire du TUI un client de la couche slash commune avec un vrai browser de sessions textuel.

Travail:

- remplacer les `if (prompt === '/...')` par un dispatch via le service commun
- faire afficher `/help` dans le feed ou la zone de statut
- faire afficher `/sessions` dans le feed avec informations compactes et identifiants exploitables
- implementer `/resume <session_id>` en reassociant le scope `tui:default` a la session choisie
- renommer le comportement actuel checkpoint restore vers `/restore <checkpoint_id>`
- conserver les commandes purement locales TUI si necessaire via le registre commun et un handler specifique de surface

Fichiers probables:

- `src/gateway/interactive-ui.tsx`
- nouveaux modules `src/conversation/*`
- `src/session/*`

Critere d'acceptation:

- dans le TUI, `/help`, `/sessions`, `/resume`, `/restore` fonctionnent avec la semantique cible

### Lot 4. Migration Telegram

Objectif:

- aligner Telegram sur la meme taxonomie sans perdre les affordances natives de Telegram.

Travail:

- remplacer les commandes Telegraf dupliquees par un mapping vers la couche slash commune
- exposer `/help`, `/sessions`, `/resume`, `/restore`
- renommer les commandes checkpoint actuelles vers la taxonomie retenue ou garder des alias compatibles si necessaire
- verifier que le chat Telegram pointe bien vers la session active du scope `telegram:<chatId>`
- clarifier le comportement de suppression de session dans un chat lie

Fichiers probables:

- `src/gateway/telegram.ts`
- `src/conversation/*`
- `src/session/*`

Critere d'acceptation:

- Telegram partage le meme comportement metier que le TUI pour les operations session/checkpoint

### Lot 5. Alignement WebUI

Objectif:

- faire de la WebUI un consommateur du meme SSOT, meme si elle garde boutons et panneaux.

Travail:

- faire passer les actions de session/checkpoint de la WebUI par les memes primitives metier communes
- optionnel: accepter les slash commands saisies dans le composeur WebUI
- verifier si `WebUiSessionRegistry` doit etre absorbe, renomme ou conserve comme store de presentation uniquement
- eviter que la WebUI reste une voie parallele avec sa propre semantique

Fichiers probables:

- `src/gateway/webui.ts`
- `src/webui/app.tsx`
- `src/session/webui-sessions.ts`
- `src/conversation/*`

Critere d'acceptation:

- les operations metier session/checkpoint de la WebUI s'appuient sur le meme contrat que les autres surfaces

### Lot 6. Documentation et architecture

Objectif:

- maintenir la doc en phase avec le nouveau SSOT.

Travail:

- mettre a jour `architecture/current/module-map.md`
- mettre a jour `architecture/current/system-overview.md`
- mettre a jour `docs/yagr-docs/usage/tui.md`
- mettre a jour `docs/yagr-docs/usage/telegram.md`
- documenter la semantique de `/resume` vs `/restore`

Critere d'acceptation:

- aucune doc n'annonce encore l'ancien comportement `/resume = checkpoint`

### Lot 7. Tests

Objectif:

- couvrir la nouvelle semantique et empecher le drift futur entre facades.

Travail:

- tests unitaires du parser slash
- tests unitaires du registre `/help`
- tests unitaires `SessionService` pour active scope / resume / delete
- tests d'integration TUI pour `/sessions`, `/resume`, `/restore`, `/help`
- tests d'integration Telegram pour les memes commandes
- tests WebUI ou gateway pour verifier l'alignement des routes/actions

Fichiers probables:

- `tests/*session*`
- nouveaux tests `tests/slash-command*.test.*`
- nouveaux tests gateway TUI / Telegram / WebUI selon l'infra existante

Critere d'acceptation:

- une regression de semantique slash ou de mapping session/checkpoint fait echouer les tests

## Details d'implementation par commande

### `/help`

Doit:

- lister les commandes disponibles dans la surface courante
- afficher pour chaque commande: usage court + description courte
- etre derive du registre central

Ne doit pas:

- avoir une liste hardcodee dans chaque facade

### `/sessions`

Doit:

- lister les sessions du scope courant, triees par `updatedAt` decroissant
- afficher `id`, `title`, `updatedAt`
- marquer la session active
- afficher si la session est fermee si cette information est disponible

Question d'implementation a trancher:

- lister uniquement le scope courant ou toutes les sessions de meme facade. Recommandation: scope courant uniquement pour Telegram, facade `tui:default` pour TUI, collection WebUI globale pour l'onglet courant.

### `/resume <session_id>`

Doit:

- valider que la session existe et est accessible dans la facade
- reassocier la session active du scope courant a `session_id`
- recharger l'etat de presentation de la facade si possible
- reinitialiser l'etat transitoire local devenu invalide (pending approvals, buffers de stream, overlays, etc.)

Ne doit pas:

- restaurer un checkpoint

### `/restore <checkpoint_id>`

Doit:

- operer sur la session active
- restaurer le checkpoint et l'etat de compaction associe
- expliquer clairement que cela restaure l'etat backend, pas necessairement l'affichage historique deja envoye dans Telegram

### `/new`

Doit:

- creer une nouvelle session active pour le scope courant
- laisser l'ancienne session accessible dans `/sessions`

### `/reset`

Decision a expliciter pendant le codage:

- soit garder `/reset` comme alias de `/new`
- soit garder `/reset` comme operation locale de purge de feed sans nouvelle session

Recommandation:

- aligner `/reset` sur `/new` si possible pour eviter deux concepts quasi identiques

### `/save`

Doit:

- creer un checkpoint de la session active
- retourner l'identifiant du checkpoint cree

### `/checkpoints`

Doit:

- lister les checkpoints de la session active
- afficher `id`, `createdAt`, `messageCount`

### `/delete <session_id>`

Doit:

- supprimer une session non active ou definir explicitement le comportement si la session active est supprimee
- supprimer metadata, memoires et checkpoints associes via `SessionService`

Question d'implementation a trancher:

- si on supprime la session active, faut-il creer automatiquement une nouvelle session vide pour le scope courant. Recommandation: oui.

## Points d'attention

### 1. WebUI et etat de presentation riche

La WebUI persiste aujourd'hui des `displayMessages` et un `displayThread` via `WebUiSessionRegistry`.

Le codage doit choisir explicitement entre:

- conserver ce store comme couche de presentation WebUI seulement
- ou extraire une notion plus generique de transcript de session partage

Ne pas laisser `WebUiSessionRegistry` devenir un faux SSOT des sessions.

### 2. Nettoyage d'etat local lors d'un `/resume`

Chaque facade a des etats transitoires propres:

- TUI: feed, buffers de stream, pending approvals, workflow embeds, scroll
- Telegram: pending approvals, indication de run en cours
- WebUI: thread, browse overlay, streaming state, selected session

Le service commun ne doit pas connaitre ces details, mais le resultat structure de commande doit indiquer a la facade quel type de reset local effectuer.

### 3. Compatibilite et aliases

Si la migration doit rester douce, prevoir des alias temporaires:

- TUI: `/resume` ancien sens -> deprecie puis remappe vers message d'aide
- Telegram: `/checkpoint_restore`, `/checkpoint_save`, `/checkpoint_delete` -> alias vers la nouvelle taxonomie

La deprecation doit etre centralisee dans le registre commun, pas recopiee.

### 4. Concurrence et surfaces multiples

Une meme session peut etre modifiee par plusieurs surfaces ou runs. Le codage doit verifier:

- ce qui est garanti si TUI et WebUI pointent vers la meme session
- comment les sessions actives par scope coexistent
- si des verrous ou messages explicatifs sont necessaires pendant un run en cours

## Ordre recommande pour un agent de codage

1. Extraire types + registre slash canonique.
2. Renforcer `SessionService` pour la reprise explicite de session par scope.
3. Migrer TUI sur la couche commune et renommer checkpoint restore vers `/restore`.
4. Migrer Telegram sur la meme couche avec aliases eventuels.
5. Aligner WebUI sur les memes primitives metier.
6. Ajouter tests unitaires et d'integration.
7. Mettre a jour la doc d'architecture et d'usage.

## Definition of done

Le chantier est considere termine si:

- TUI, WebUI et Telegram partagent le meme SSOT de commandes slash
- `/help` liste correctement les commandes et descriptions de la surface courante
- `/resume` reprend une session de conversation dans TUI et Telegram
- `/restore` restaure un checkpoint de la session active
- la WebUI appelle les memes primitives metier pour sessions et checkpoints
- les tests couvrent la separation session/checkpoint et la taxonomie slash
- la documentation courante de l'architecture reflète la nouvelle repartition des responsabilites
