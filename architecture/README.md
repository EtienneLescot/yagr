# Architecture Dossier

This folder documents the current Yagr platform architecture.

The repository is no longer best described as a single agent app with helper modules.

The active architectural model is now:

- **core runtime packages**
- **plugin packages**
- **surface packages**
- **app compositions**

## Folders

- `current/`: factual documentation of what exists in the repo now
- `target/`: remaining forward-looking direction where the work is still incomplete

## Recommended reading

1. `current/system-overview.md`
2. `current/module-map.md`
3. `target/yagr-engine-architecture.md`

## Current doctrine

Yagr core should own:

- deepagent bootstrap
- providers
- sessions/checkpoints
- runtime events
- stream adaptation
- conversation behavior
- reusable WebUI/TUI surfaces

Plugins should own:

- manager-specific integrations
- domain-specific setup or operational behavior

Apps should own:

- final composition and user-facing packaging
