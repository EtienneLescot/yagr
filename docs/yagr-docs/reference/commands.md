# Commands

## Runtime

```bash
yagr "<prompt>"              # run a one-shot local coding-agent prompt
yagr setup                   # configure the local runtime
yagr llm setup               # configure the language model
yagr start                   # start configured gateway surfaces in background
yagr tui                     # start the terminal UI
yagr webui                   # start the Web UI
yagr gateway status          # show gateway status
```

## Telegram

```bash
yagr telegram setup
yagr telegram start
yagr telegram status
yagr telegram onboarding
yagr telegram reset
```

## Provider Proxies

```bash
yagr proxy start <provider>
yagr proxy status [provider]
yagr proxy stop <provider>
```

## Agent Skills

```bash
yagr skills list
yagr skills install <source>
yagr skills install <source> --scope workspace
yagr skills remove <name>
yagr skills path
```

Yagr only installs and exposes skill directories. The runtime skill discovery and progressive disclosure are provided by DeepAgents.js.

## Local State

```bash
yagr config show
yagr config reset
yagr paths
yagr reset --scope config+creds
yagr uninstall
```
