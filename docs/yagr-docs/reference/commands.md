# Commands

## Runtime

```bash
yagr "<prompt>"              # run a one-shot local coding-agent prompt
yagr setup                   # configure the local runtime
yagr llm setup               # configure the language model
yagr start                   # start the interactive local agent
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

## Local State

```bash
yagr config show
yagr config reset
yagr paths
yagr reset --scope config+creds
yagr uninstall
```
