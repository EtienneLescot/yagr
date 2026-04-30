<div align="center">
  <img src="./docs/static/img/yagr-logo.png" alt="Yagr" width="140" />
  <h1>YAGR</h1>
  <p><strong>Your Agent Grounded in Reality</strong></p>
  <p><strong>Autonomous coding without the black box.</strong></p>
  <p>
    Local-first runtime. Provider-agnostic models. Observable agent work.
  </p>
</div>

Yagr is a local-first autonomous coding-agent runtime built on DeepAgents.js.

It gives coding agents a real operating environment: local files, shell execution, provider freedom, sessions, checkpoints, runtime events, and multiple control surfaces.

The goal is simple:

> Let the agent work autonomously. Never let its work disappear into chat history.

## Why Yagr

Most coding agents expose a conversation.

Yagr is built around the stronger idea that autonomous work needs a runtime you can inspect, control, and trust.

- **Grounded in your repo**: the agent works against real files, commands, project instructions, and local context.
- **Grounded in execution**: shell and file operations are first-class runtime behavior, not a simulated chat trick.
- **Grounded in sessions**: work is scoped, resumable, and checkpointable.
- **Grounded in interfaces**: use the same runtime from CLI, TUI, Web UI, or Telegram.
- **Grounded in standards**: Yagr builds on LangChain and DeepAgents.js instead of hiding everything behind a custom black box.

## Positioning

Open-ended does not have to mean opaque.

Yagr is not trying to be a hardcoded workflow runner. It is not bound to a specific orchestrator, Telegram, a specific model provider, or a single interface.

Yagr is the control plane around the agent:

- the agent stays capable and general
- providers stay swappable
- skills stay external and composable
- facades stay thin
- runtime behavior stays observable

The target direction is an **Impact Ledger**: a user-friendly dashboard of meaningful agent effects such as changed files, created scripts, dependency changes, long-running processes, automations, checkpoints, and durable artifacts.

Chat is one view. Impact is the record that matters.

See [architecture/target/observability-impact-ledger.md](./architecture/target/observability-impact-ledger.md) for the target plan.

## What Exists Today

- local coding-agent behavior
- provider/model configuration
- account-backed provider proxies
- session and checkpoint management
- runtime event streaming
- CLI/TUI/Web UI/Telegram surfaces

## What It Does Not Own

Yagr does not include a built-in domain backend.

If a project uses external tools or orchestrators, the agent can work with them through ordinary local files, shell commands, installed skills, or future plugins. Those integrations are not hardcoded into Yagr core.

That is the point: Yagr should be opinionated about runtime clarity, not about what your agent is allowed to build.

## Basic Usage

```bash
npm install
npm run build
node dist/cli.js "inspect this repository and summarize it"
```

Start the local Web UI:

```bash
node dist/cli.js webui
```

Configure model/runtime settings:

```bash
node dist/cli.js setup
node dist/cli.js llm setup
```

## Architecture

See `architecture/current/` for the current module map and runtime flows.

See `architecture/target/` for target plans that are not yet implemented.
