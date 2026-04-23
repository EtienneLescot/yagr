# Unified Session Management And Slash Commands

This work is now implemented.

The original target described here has been realized through extracted packages rather than through the former root `src/session/*` and `src/conversation/*` modules.

## Current result

The shared behavior now lives in:

- `@yagr/session-service`
- `@yagr/session-checkpoint`
- `@yagr/conversation-core`
- `@yagr/conversation-service`

And the surfaces now consume that extracted layer instead of maintaining separate slash/session logic.

## Meaningful product outcomes

- `/resume` is about conversation sessions
- `/restore` is about checkpoints
- slash command taxonomy is shared across surfaces
- TUI, WebUI, and Telegram delegate to the same session/conversation behavior layer

## Status

This page is kept only as a historical marker and should eventually be removed once all references to the former design have disappeared from the dossier.
