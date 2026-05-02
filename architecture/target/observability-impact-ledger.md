# Target Plan: Reality Layer And Impact Ledger

Yagr means **Your Agent Grounded in Reality**.

The target direction is to make that phrase concrete: an autonomous coding agent can stay open-ended, provider-agnostic, and skill-driven, while every meaningful effect it creates remains observable, attributable, and manageable.

## Product Thesis

Most autonomous agents expose conversation history. That is not enough.

A coding agent can create scripts, modify configuration, install dependencies, start long-running processes, register webhooks, create workflows, or leave automations behind. If those effects only exist as scattered chat messages, the agent becomes a black box.

Yagr should treat the chat as one view of the work, not the source of truth for the work.

Target promise:

> Autonomous coding without the black box.

Operational rule:

> Whatever the agent changes in the real environment must be visible, attributable, and reviewable.

## Scope

This target plan tracks the remaining observability layer work beyond the current foundation documented in `architecture/current/`: `@yagr/impact-ledger` owns the canonical impact event schema and append-only local JSONL ledger, and `@yagr/reality-observer` can classify selected `RuntimeOperationEvent` entries into impact events.

It must not turn Yagr into a fixed orchestrator, a narrow workflow runner, or a domain-specific backend.

Yagr remains:

- local-first
- provider-agnostic
- DeepAgents.js-based
- skill-friendly
- surface-neutral
- open to external orchestrators through skills, plugins, shell commands, or files

The new layer observes meaningful effects. It does not decide what the agent is allowed to build by default.

## Core Principles

### Runtime-observed evidence is authoritative

The agent may describe intent, risk, or rationale, but the runtime must own the evidence whenever possible.

Examples:

- The agent may say it created a workflow.
- Yagr verifies that a workflow file was created or modified.
- The agent may say a process is running.
- Yagr records the command, PID when available, port when detected, and session origin.

Agent-authored metadata is useful context. Runtime-observed effects are the authority.

### Observe effects, not noise

Yagr should not flood users with every read, search, or minor tool call.

Yagr should record actions that:

- change files or directories
- install, remove, or update dependencies
- start, stop, or schedule processes
- create automations, workflows, services, or webhooks
- touch credentials or sensitive configuration
- call external systems in a state-changing way
- create durable artifacts
- affect future execution
- mark important decisions or checkpoints

### Opinionated contract, open implementations

Yagr should be opinionated about the observability contract:

- event schema
- impact categories
- artifact model
- local storage
- session linkage
- dashboard views
- export interfaces

Yagr should stay open about implementations:

- LLM providers
- skills
- orchestrators
- workflow engines
- external tools
- observability sinks
- UI surfaces

### Facades stay thin

TUI, WebUI, Telegram, CLI, and future surfaces render the reality layer. They do not own it.

The authority belongs in core runtime packages, exposed through facades.

### Providers stay thin

Provider packages must not own impact tracking or observability policy.

The reality layer observes the common runtime/tooling boundary, not provider-specific behavior.

## Target Concepts

### Impact Ledger

The Impact Ledger is the append-only local record of meaningful effects.

Possible package:

- `@yagr/impact-ledger`

Responsibilities:

- define impact event types
- persist impact events locally
- link events to sessions, turns, tools, artifacts, and checkpoints
- provide queries for dashboard and CLI views
- support export to external sinks later

Illustrative event shape:

```ts
export interface ImpactEvent {
  id: string;
  sessionId: string;
  turnId?: string;
  taskId?: string;
  timestamp: string;
  actor: 'agent' | 'user' | 'runtime' | 'tool';
  category:
    | 'file_change'
    | 'shell_command'
    | 'process_started'
    | 'process_stopped'
    | 'dependency_change'
    | 'automation_created'
    | 'automation_updated'
    | 'automation_removed'
    | 'external_call'
    | 'credential_access'
    | 'artifact_created'
    | 'checkpoint'
    | 'decision';
  impact: 'low' | 'medium' | 'high';
  persistence: 'ephemeral' | 'durable' | 'unknown';
  reversible: boolean | 'unknown';
  summary: string;
  evidence: unknown;
  relatedFiles?: string[];
  relatedCommands?: string[];
  artifactId?: string;
}
```

### Artifact Registry

The Artifact Registry tracks durable objects created or modified through agent work.

Possible package:

- `@yagr/artifact-registry`

Artifact examples:

- generated script
- modified config
- test report
- local service
- scheduled job
- GitHub Actions workflow
- workflow export
- Docker Compose service
- PM2 process
- systemd unit
- cron entry
- webhook definition
- skill directory

Target metadata:

```ts
export interface AgentArtifact {
  id: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  kind:
    | 'script'
    | 'config'
    | 'workflow'
    | 'automation'
    | 'service'
    | 'report'
    | 'skill'
    | 'external_resource';
  title: string;
  location?: string;
  owner: 'agent' | 'user' | 'external';
  status: 'active' | 'inactive' | 'unknown' | 'removed';
  howToRun?: string;
  howToStop?: string;
  howToRemove?: string;
  requiresSecrets?: string[];
  sourceEvents: string[];
}
```

### Reality Observer

The Reality Observer detects effects from runtime activity.

Possible package:

- `@yagr/reality-observer`

Responsibilities:

- classify runtime operation events into impact events
- compare filesystem snapshots for relevant write effects
- identify durable process starts where possible
- detect known automation files and service definitions
- attach evidence to agent-authored impact summaries
- avoid provider-specific logic

This layer should sit near runtime events, stream adaptation, shell/file execution boundaries, and session/checkpoint infrastructure.

It must not live in WebUI, TUI, Telegram, or provider packages.

### Agent Impact Notes

The agent should be encouraged to produce structured impact notes after meaningful work.

These notes are not authoritative. They enrich the observed record.

Example:

```json
{
  "title": "Created issue sync workflow",
  "purpose": "Sync labeled GitHub issues into a local backlog file",
  "persistent": true,
  "howToDisable": "Remove .github/workflows/issue-sync.yml",
  "requiresSecrets": ["GITHUB_TOKEN"]
}
```

The runtime can then attach, verify, downgrade, or flag that metadata based on actual evidence.

## Dashboard Direction

The WebUI should become more than a chat surface.

Target views:

- **Timeline**: sessions, turns, major operations, decisions, and checkpoints.
- **Impact**: durable changes and state-changing actions.
- **Artifacts**: scripts, configs, workflows, services, reports, and skills created or modified by the agent.
- **Processes**: commands still running or recently launched by Yagr sessions.
- **Automations**: workflows, schedules, webhooks, and orchestrator-backed jobs.
- **Files Changed**: grouped diffs by session and task.
- **Decisions**: architectural or operational choices made during work.
- **Cleanup**: reversible items, stale artifacts, and removal instructions.

The chat remains useful, but it should no longer be the only memory of agent work.

## Orchestrator Strategy

Yagr should not bind itself to any orchestrator.

Instead, it should define a common automation artifact model that can represent:

- GitHub Actions
- cron
- systemd
- PM2
- Docker Compose
- Temporal
- Make
- Zapier
- custom scripts
- future plugin-backed orchestrators

Skills and plugins can add richer support for specific orchestrators, but the core model stays generic.

## Implementation Phases

### Phase 1: Impact schema and local ledger

Status: implemented as the current `@yagr/impact-ledger` package.

- Add canonical impact event types.
- Add append-only local persistence.
- Link impact events to session IDs and runtime operation IDs.
- Provide query APIs for session, category, artifact, and time range.
- Keep existing runtime events intact.

### Phase 2: Runtime effect capture

Status: partially implemented as `@yagr/reality-observer` for selected runtime operation events. Streaming WebUI, TUI, and Telegram runs pass operation events through the shared gateway stream adapter into the ledger. Remaining work includes deeper filesystem snapshots, process metadata, raw evidence separation, and broader high-risk detection.

- Convert meaningful `RuntimeOperationEvent` entries into impact candidates.
- Capture file write events and shell commands at the shared runtime boundary.
- Mark high-risk categories such as credentials, dependency changes, and long-running processes.
- Store raw evidence separately from display summaries.

### Phase 3: Artifact registry

- Promote durable impact events into artifacts.
- Track lifecycle updates: created, updated, active, inactive, removed, unknown.
- Add cleanup metadata when available.
- Link artifacts to checkpoints and sessions.

### Phase 4: Agent impact notes

- Add a structured output convention for impact notes.
- Inject concise guidance through the coding middleware.
- Validate notes against observed evidence where possible.
- Flag unverified claims instead of treating them as truth.

### Phase 5: Dashboard surfaces

Status: partially implemented as a shared `/impact` summary command for WebUI, TUI, and Telegram. Dedicated dashboard views remain target work.

- Add Impact, Artifacts, Automations, and Cleanup views to WebUI.
- Expose compact impact summaries in TUI/CLI.
- Allow Telegram to request summaries without becoming a heavy dashboard.

### Phase 6: Open sinks and plugins

- Add export APIs for JSONL, local files, and future observability sinks.
- Let plugins contribute artifact detectors and enrichers.
- Keep the core schema stable and generic.

## Non-Goals

- Do not replace DeepAgents.js native execution model.
- Do not build a hard dependency on any workflow engine.
- Do not move business logic into WebUI, TUI, Telegram, or CLI.
- Do not put observability policy in provider packages.
- Do not log every tiny read/search operation as user-facing impact.
- Do not trust agent-written summaries as the sole source of truth.

## Success Criteria

Yagr succeeds at this direction when a user can answer:

- What did the agent change?
- Why did it change it?
- Which session created it?
- Is it still active?
- Is it reversible?
- How do I stop it?
- How do I remove it?
- Which files, commands, or external systems are involved?

If those answers are available without digging through chat history, Yagr is genuinely grounded in reality.
