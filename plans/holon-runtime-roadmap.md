# Holon Runtime Roadmap

This roadmap defines the intended delivery order for the Holon runtime layer. The goal is to keep the runtime core narrow, robust, and reusable before adding more ambitious agent features.

## V1: Narrow Runtime Core

Priority: must-have

- Explicit completion as a runtime concern, not plain assistant text.
- Guarded completion based on unresolved failures, missing validation, missing push, or open required actions.
- Recoverable tool errors that stay in-band and can trigger recovery passes.
- Separate runtime state for control flow and UI.
- Minimal hooks and policy injection at tool and completion boundaries.
- Command-output streaming as a first-class runtime/UI behavior.
- Lightweight journal and telemetry events for debugging and state visibility.

Acceptance criteria:

- A task cannot be marked complete only because the model stops.
- A failed tool does not kill the run by default if local recovery is possible.
- The UI can distinguish running, streaming, waiting, resumable, completed, and blocked states without transcript parsing.
- Product-specific rules remain outside the runtime core.

## V1.5: Operational Hardening

Priority: next

- Permission flow on top of required actions.
- Better user-facing resume semantics after a permission or input blocker.
- More focused runtime semantics tests.
- Cleaner user-visible reporting when the run is blocked rather than completed.

Acceptance criteria:

- Permission blockers can be surfaced, approved, and retried without resetting the conversation.
- Input blockers are represented explicitly and can be resumed with a follow-up user message.
- Runtime tests cover tool blocking, completion rejection, and recovery semantics.

## V2: Advanced Runtime Concerns

Priority: after V1 loop stability

- Context compaction contract and event model.
- Resumability beyond one live process, based on journal and required actions.
- Durable task checkpoint or equivalent resume surface.

Acceptance criteria:

- Long-running tasks can continue after context reduction without losing open work.
- A blocked or paused run can be resumed from saved runtime evidence rather than only transcript history.

## Deferred

These capabilities are intentionally postponed until the mono-agent runtime is solid:

- Bounded subagents.
- Rich plugin ecosystems.
- Heavy orchestration or graph execution.
- Domain-specific workflow policies embedded in the runtime.

## Design Rules

- The runtime core owns task lifecycle, execution loop, failure reinjection, completion gating, and inspectable state.
- Policies, hooks, skills, and product UX sit above the runtime core.
- The runtime stays compatible with low-level SDKs rather than replacing them.
- Domain-specific repository rules must not leak into the runtime contract.