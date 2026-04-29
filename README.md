<div align="center">
  <img src="./docs/static/img/yagr-logo.png" alt="Yagr" width="140" />
  <h1>Yagr</h1>
  <p><strong>Autonomous local coding agent.</strong></p>
</div>

Yagr is a local coding-agent runtime built on deepagentsjs. It combines a coding-oriented middleware layer, local shell/file execution, provider runtime support, sessions/checkpoints, and thin surfaces such as CLI, Web UI, and Telegram.

## What It Owns

- local coding-agent behavior
- provider/model configuration
- account-backed provider proxies
- session and checkpoint management
- runtime event streaming
- CLI/Web UI/Telegram surfaces

## What It Does Not Own

Yagr does not include a built-in domain backend. If a project uses external tools, the agent can work with them as ordinary local files and shell commands, but those integrations are not part of Yagr core.

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
