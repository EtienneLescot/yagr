# Unified Session Management And Slash Commands

## Objective

Establish unified management of conversation sessions across TUI, WebUI, and Telegram, with a unique taxonomy for slash commands and a single authority point for session and checkpoint operations.

The target result must satisfy the following constraints:

- `SessionService` remains the SSOT for session lifecycle.
- slash logic no longer lives in each facade.
- `/resume` references conversation sessions, never checkpoints.
- `/restore` is reserved for checkpoint restoration.
- `/help` lists available commands with their description.
- TUI, WebUI, and Telegram share the same command catalog and same business semantics.
- facades remain thin and only adapt I/O and rendering.

## Current Problem

Observed state in the repo:

- TUI: inline parsing in `src/gateway/interactive-ui.tsx` with local `if` statements.
- Telegram: inline Telegraf commands in `src/gateway/telegram.ts`.
- WebUI: session/checkpoint actions via API and UI, without a common slash layer.
- `SessionService` already manages sessions and checkpoints, but not a usable browse/resume/delete UX uniformly across facades.
- `WebUiSessionRegistry` stores WebUI presentation state that cannot be reused as-is by TUI and Telegram.
- Current semantic conflict: in TUI, `/resume` restores a checkpoint, whereas the expected behavior is session resumption.

## Design Decisions

### 1. SSOT for slash commands

Introduce a dedicated common layer, for example in `src/conversation/`:

- `slash-command-types.ts`
- `slash-command-registry.ts`
- `slash-command-service.ts`
- `slash-command-render.ts` if necessary to format common textual outputs

Responsibilities of this layer:

- parse raw slash input
- resolve a canonical command
- validate arguments
- execute the business action via `SessionService` and associated services
- return a structured result, independent of the facade
- expose the command catalog for `/help`

Facades must no longer reimplement:

- the command list
- their descriptions
- their aliases
- their semantics
- their argument validation

### 2. Canonical command taxonomy

Do not keep an implicit divergent taxonomy between surfaces. Introduce a domain-oriented canonical vocabulary:

- `/help`
- `/sessions`
- `/resume <session_id>`
- `/delete <session_id>`
- `/new`
- `/reset`
- `/checkpoints`
- `/save`
- `/restore <checkpoint_id>`
- `/checkpoint_delete <checkpoint_id>`
- `/pending`
- `/approve`
- `/compact`
- `/open`
- `/toggle-thinking`
- `/toggle-cli`
- `/stop`
- `/exit`

Product notes:

- `/resume` becomes strictly "resume a conversation session".
- `/restore` becomes strictly "restore a checkpoint".
- `/help` must describe commands visible in the current facade.
- `/sessions` must list conversation sessions with identifier, title, active/closed status, dates, and optionally an active session marker.

### 3. Capabilities per facade

The catalog is shared, but not all commands are necessarily actionable in each surface. The SSOT must distinguish:

- canonical command
- availability per facade (`tui`, `webui`, `telegram`)
- user description per facade if necessary
- expected rendering form

Examples:

- `/exit` is useful to TUI, not to Telegram.
- `/toggle-cli` is useful to TUI, probably useless elsewhere.
- `/open` only makes sense on local surfaces capable of opening a URL.

The important point is that the availability decision must live in the common registry, not in each facade.

### 4. SSOT for browsable sessions

`SessionService` must become the authoritative API for:

- listing sessions of a facade scope
- identifying the active session of a scope
- creating a new session in a scope
- resuming an existing session in a scope
- deleting a session
- closing or archiving a session

Target API to add or clarify in `src/session/session-service.ts`:

- `listForScope(scope)` enriched for UI use
- `getActiveForScope(scope)`
- `resumeForScope(scope, sessionId)`
- `createForScope(scope, options?)`
- `deleteForScope(scope, sessionId)` or equivalent safeguards

The above operations must encapsulate the `activeByScopeKey` management currently hidden in `DeepAgentSessionStore`.

### 5. Strict separation sessions vs checkpoints

Keep a clear difference between:

- session: long-lived conversational identity
- checkpoint: restorable snapshot of a session

Expected effects:

- `/sessions` does not list checkpoints
- `/resume` does not touch checkpoints
- `/checkpoints` lists checkpoints of the active session
- `/restore` restores a checkpoint on the active session
- `/save` creates a checkpoint of the active session

### 6. Session resume and runtime reality

The repo currently persists session metadata but not necessarily all runtime state beyond the process, depending on the actual checkpointer.

Work to explicitly frame in implementation:

- verify if the active checkpointer allows reliable cross-restart resume
- if not, clearly document the limitation and avoid misleading UX
- if required by product, replace the volatile checkpointer with a durable implementation or align existing persistence

Coding must not leave a `/resume` command that promises more than the runtime actually guarantees.

## Target Architecture

### `src/session/`

Remains the SSOT for session lifecycle:

- session metadata
- scope -> active session mapping
- creation / rotation / resume / deletion
- checkpoints
- optional shared transcript recovery if that need is retained

### `src/conversation/`

New SSOT layer for conversational commands:

- parse
- command registry
- dispatch
- structured results
- `/help` help

### `src/gateway/`

Remains a thin adapter per surface:

- converts user input into command or normalized prompt
- calls the `conversation/` layer
- renders results in the surface's format
- manages rendering specifics and local navigation

### `src/webui/`

WebUI must hook into the same SSOT, even if it retains button interactions. UI actions must call the same business primitives as slash commands.

## Implementation Plan

### Lot 0. Framing and invariants

Objective:

- freeze the command contract and session/checkpoint semantics before any implementation.

Work:

- define the canonical list of commands and tolerated aliases
- define supported surfaces per command
- define minimum structured outputs
- define standardized errors (`unknown_command`, `invalid_arguments`, `unsupported_in_surface`, `session_not_found`, `checkpoint_not_found`, etc.)

Deliverables:

- common command and result types
- TUI/WebUI/Telegram compatibility table

Acceptance criteria:

- a single source enumerates all supported commands and their semantics

### Lot 1. Session SSOT reinforcement

Objective:

- make `SessionService` sufficient to navigate between sessions by scope without hidden logic in facades.

Work:

- add a primitive to retrieve the active session of a scope
- add a primitive to activate/resume an existing session in a scope
- clarify creation and rotation behaviors
- add safeguards for active session deletion if necessary
- enrich listed resumes with `closedAt`, `scope`, `isActiveForScope` if useful

Likely files:

- `src/session/session-service.ts`
- `src/session/deepagent-sessions.ts`
- `src/session/session-types.ts`

Acceptance criteria:

- TUI and Telegram can list and reassign the active session without reimplementing scope logic

### Lot 2. Common slash command service

Objective:

- remove inline command logic from facades.

Work:

- create a unique slash command parser
- create a command registry with metadata (`name`, `description`, `usage`, `surfaces`, `aliases`)
- implement a dispatcher that calls `SessionService`, `CompactionService`, and necessary adapters
- return structured results, not just plain text
- implement `/help` from the registry

Likely files:

- `src/conversation/slash-command-types.ts`
- `src/conversation/slash-command-registry.ts`
- `src/conversation/slash-command-service.ts`
- `src/conversation/index.ts`

Acceptance criteria:

- the command list is defined only once in the repo

### Lot 3. TUI Migration

Objective:

- make TUI a client of the common slash layer with a real textual session browser.

Work:

- replace `if (prompt === '/...')` with dispatch via the common service
- make `/help` display in the feed or status area
- make `/sessions` display in the feed with compact information and usable identifiers
- implement `/resume <session_id>` by reassigning `tui:default` scope to the chosen session
- rename current checkpoint restore behavior to `/restore <checkpoint_id>`
- keep purely local TUI commands if necessary via the common registry and a surface-specific handler

Likely files:

- `src/gateway/interactive-ui.tsx`
- new modules `src/conversation/*`
- `src/session/*`

Acceptance criteria:

- in TUI, `/help`, `/sessions`, `/resume`, `/restore` work with target semantics

### Lot 4. Telegram Migration

Objective:

- align Telegram on the same taxonomy without losing native Telegram affordances.

Work:

- replace duplicated Telegraf commands with a mapping to the common slash layer
- expose `/help`, `/sessions`, `/resume`, `/restore`
- rename current checkpoint commands to the retained taxonomy or keep compatible aliases if necessary
- verify that the Telegram chat points to the active session of scope `telegram:<chatId>`
- clarify session deletion behavior in a linked chat

Likely files:

- `src/gateway/telegram.ts`
- `src/conversation/*`
- `src/session/*`

Acceptance criteria:

- Telegram shares the same business behavior as TUI for session/checkpoint operations

### Lot 5. WebUI Alignment

Objective:

- make WebUI a consumer of the same SSOT, even if it keeps buttons and panels.

Work:

- make WebUI session/checkpoint actions go through the same common business primitives
- accept slash commands typed in the WebUI composer (mandatory for `/XXX` unification)
- verify if `WebUiSessionRegistry` should be absorbed, renamed, or kept as presentation-only store
- avoid WebUI remaining a parallel path with its own semantics

Likely files:

- `src/gateway/webui.ts`
- `src/webui/app.tsx`
- `src/session/webui-sessions.ts`
- `src/conversation/*`

Acceptance criteria:

- WebUI session/checkpoint business operations rely on the same contract as other surfaces
- WebUI composer recognizes and executes slash commands from the common registry

### Lot 6. Documentation and Architecture

Objective:

- keep docs in sync with the new SSOT.

Work:

- update `architecture/current/module-map.md`
- update `architecture/current/system-overview.md`
- update `docs/yagr-docs/usage/tui.md`
- update `docs/yagr-docs/usage/telegram.md`
- document the semantics of `/resume` vs `/restore`

Acceptance criteria:

- no doc still announces the old `/resume = checkpoint` behavior

### Lot 7. Tests

Objective:

- cover the new semantics and prevent future drift between facades.

Work:

- unit tests for slash parser
- unit tests for `/help` registry
- unit tests for `SessionService` for active scope / resume / delete
- TUI integration tests for `/sessions`, `/resume`, `/restore`, `/help`
- Telegram integration tests for the same commands
- WebUI or gateway tests to verify routes/actions alignment

Likely files:

- `tests/*session*`
- new tests `tests/slash-command*.test.*`
- new TUI / Telegram / WebUI gateway tests based on existing infra

Acceptance criteria:

- a regression in slash semantics or session/checkpoint mapping causes test failures

## Implementation Details Per Command

### `/help`

Must:

- list available commands in the current surface
- display for each command: short usage + short description
- be derived from the central registry

Must not:

- have a hardcoded list in each facade

### `/sessions`

Must:

- list sessions of the current scope, sorted by `updatedAt` descending
- display `id`, `title`, `updatedAt`
- mark the active session
- display if the session is closed if that information is available

Implementation question to resolve:

- list only current scope or all sessions of the same facade. Recommendation: current scope only for Telegram, facade `tui:default` for TUI, global WebUI collection for the current tab.

### `/resume <session_id>`

Must:

- validate that the session exists and is accessible in the facade
- reassign the current scope's active session to `session_id`
- reload the facade's presentation state if possible
- reset invalid local transient state (pending approvals, stream buffers, overlays, etc.)

Must not:

- restore a checkpoint

### `/restore <checkpoint_id>`

Must:

- operate on the active session
- restore the checkpoint and associated compaction state
- clearly explain that this restores the backend state, not necessarily the historical display already sent in Telegram

### `/new`

Must:

- create a new active session for the current scope
- leave the old session accessible in `/sessions`

### `/reset`

Decision to clarify during coding:

- either keep `/reset` as alias of `/new`
- or keep `/reset` as local feed purge operation without new session

Recommendation:

- align `/reset` on `/new` if possible to avoid two almost identical concepts

### `/save`

Must:

- create a checkpoint of the active session
- return the created checkpoint identifier

### `/checkpoints`

Must:

- list checkpoints of the active session
- display `id`, `createdAt`, `messageCount`

### `/delete <session_id>`

Must:

- delete an inactive session or explicitly define behavior if the active session is deleted
- delete associated metadata, memories, and checkpoints via `SessionService`

Implementation question to resolve:

- if the active session is deleted, should a new empty session be automatically created for the current scope. Recommendation: yes.

## Points of Attention

### 1. WebUI and rich presentation state

WebUI currently persists `displayMessages` and a `displayThread` via `WebUiSessionRegistry`.

Coding must explicitly choose between:

- keep this store as WebUI-only presentation layer
- or extract a more generic shared session transcript notion

Do not let `WebUiSessionRegistry` become a false sessions SSOT.

### 2. Local state cleanup on `/resume`

Each facade has its own transient states:

- TUI: feed, stream buffers, pending approvals, workflow embeds, scroll
- Telegram: pending approvals, indication of running
- WebUI: thread, browse overlay, streaming state, selected session

The common service must not know these details, but the structured command result must indicate to the facade what type of local reset to perform.

### 3. Compatibility and aliases

If migration must be smooth, plan for temporary aliases:

- TUI: `/resume` old sense -> deprecated then remapped to help message
- Telegram: `/checkpoint_restore`, `/checkpoint_save` -> alias to new taxonomy (`/checkpoint_delete` is already canonical)

Deprecation must be centralized in the common registry, not copied.

### 4. Concurrency and multiple surfaces

The same session can be modified by multiple surfaces or runs. Coding must verify:

- what is guaranteed if TUI and WebUI point to the same session
- how active sessions by scope coexist
- if locks or explanatory messages are necessary during an ongoing run

## Recommended Order for a Coding Agent

1. Extract types + canonical slash registry.
2. Reinforce `SessionService` for explicit session resume by scope.
3. Migrate TUI to the common layer and rename checkpoint restore to `/restore`.
4. Migrate Telegram to the same layer with possible aliases.
5. Align WebUI on the same business primitives.
6. Add unit and integration tests.
7. Update architecture and usage docs.

## Definition of Done

The work is considered complete if:

- TUI, WebUI, and Telegram share the same slash commands SSOT
- `/help` correctly lists commands and descriptions for the current surface
- `/resume` resumes a conversation session in TUI and Telegram
- `/restore` restores a checkpoint of the active session
- WebUI calls the same business primitives for sessions and checkpoints
- tests cover session/checkpoint separation and slash taxonomy
- current architecture documentation reflects the new distribution of responsibilities
