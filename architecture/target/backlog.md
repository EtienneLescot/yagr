# Target Backlog

This section is ephemeral.

It must contain only the remaining work to converge toward a clean and stable architecture. Everything already implemented must be documented in `../current/`, not here.

## Remaining work

The target direction reference is documented in `yagr-engine-architecture.md`.

### Yagr Engine convergence

- Rename and refocus `holon` as `Yagr Engine`
- Formalize a canonical IR distinct from target backends
- Integrate the AI-native graph UI of `Yagr Engine` into `Yagr` surfaces
- Make `Hatchet` the runtime of the `Yagr Engine` path
- Formalize the upstream backend choice `n8n` vs `Yagr Engine + Hatchet`
- Progressively extract the `n8n` coupling still present in prompt, tooling, and run flows
- Unify chat and UI edits around the same `Yagr Engine` patch/validation pipeline

### Unified facade session management (implemented)

- `src/conversation/` — SSOT slash commands with canonical registry
- `SessionService` enriched: `getActiveForScope()`, `listCheckpointsSync()`
- `/resume` → conversation session; `/restore` → checkpoint
- TUI, Telegram, and WebUI dispatch via `SlashCommandService`
- `/help`, `/sessions`, `/new`, `/delete`, `/resume`, `/restore`, `/save`, `/checkpoints`, `/checkpoint_delete` available on all 3 surfaces

## Lifetime rule

- When an item is completed, it is removed from this page.
- When a new architectural reality exists, it is documented in `../current/`.
- `target/` must remain minimal; if everything has converged, this file contains no more todos.
