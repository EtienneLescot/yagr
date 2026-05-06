# System Overview

This repository is now a local autonomous coding-agent runtime.

## Current Architectural Model

```mermaid
flowchart TD
    User[User]

    subgraph App[App and CLI]
      AgentApp[@yagr/agent]
    end

    subgraph Facades[Optional Facade Packages]
      RuntimeFacade[@yagr/runtime]
      SurfacesFacade[@yagr/surfaces]
    end

    subgraph Core[Core Runtime Packages]
      Bootstrap[@yagr/deepagent-bootstrap]
      Provider[@yagr/provider-runtime]
      Session[@yagr/session-service]
      Events[@yagr/runtime-events]
      Impact[@yagr/impact-ledger]
      Observer[@yagr/reality-observer]
      Stream[@yagr/stream-adapter]
      Conversation[@yagr/conversation-service]
    end

    subgraph SurfacePackages[Surface Packages]
      WebuiSurface[@yagr/webui-surface]
      TuiSurface[@yagr/tui-surface]
    end

    User --> AgentApp
    AgentApp --> RuntimeFacade
    AgentApp --> SurfacesFacade
    RuntimeFacade --> Bootstrap
    RuntimeFacade --> Provider
    RuntimeFacade --> Session
    RuntimeFacade --> Events
    RuntimeFacade --> Impact
    RuntimeFacade --> Observer
    RuntimeFacade --> Stream
    RuntimeFacade --> Conversation
    SurfacesFacade --> WebuiSurface
    SurfacesFacade --> TuiSurface
```

## Core Ownership

Yagr owns:

- deepagent bootstrap
- coding-oriented middleware
- generic Agent Skills installation and source-path resolution
- local shell and file execution semantics
- provider/model runtime
- sessions/checkpoints, including first-class checkpoint lifecycle APIs, native LangGraph checkpoint restore, opaque surface payloads, checkpoint summaries, policies, and lifecycle events
- runtime events
- reusable runtime context compaction and provider-reported context usage metrics
- impact event schema and append-only local impact ledger
- runtime-to-impact classification for meaningful operation events
- shared `/impact` slash summaries for WebUI, TUI, and Telegram
- stream adaptation
- conversation/slash behavior
- reusable surface primitives

The architectural source of truth now lives in the granular runtime packages. The root `@yagr/agent` package remains the assembled app/CLI distribution, while downstream products are expected to compose directly from the runtime packages when footprint and dependency control matter.

Yagr does not own domain-specific backends. External systems can still be used by the agent through ordinary local shell and file operations when the user asks, but no such backend is part of the built-in architecture.

## Mental Model

Yagr is:

- a local autonomous coding agent
- a reusable runtime platform
- a set of thin local and remote chat surfaces
- provider/runtime/session infrastructure for coding work

Installed Agent Skills are external instructions. Yagr stores and exposes skill directories, while DeepAgents.js owns runtime discovery and progressive disclosure.

The Impact Ledger is the current authority for append-only records of meaningful effects. The Reality Observer is the current runtime-side classifier that can convert selected `RuntimeOperationEvent` entries into impact events without putting observability policy in providers or surfaces.

WebUI, TUI, and Telegram expose impact through the shared `/impact` slash command. The facades only pass user input to `@yagr/conversation-service` and render the returned summary; ledger querying and summary formatting stay in the runtime/conversation layer.
