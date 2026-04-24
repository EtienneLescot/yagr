---
title: Windows Support
description: "Run Yagr natively on Windows with PowerShell, Docker Desktop, and the Docker-managed n8n runtime."
---

# Windows Support

Yagr supports native Windows with PowerShell as the shell contract.

## Requirements

- Windows 11 x64, or Windows 10 x64 where the required Node and Docker versions still work
- Native Node.js
- PowerShell
- Docker Desktop for Windows for Yagr-managed local n8n
- `cloudflared` in `PATH` or installable by `yagr n8n tunnel setup`

WSL can still be used as a Linux environment, but it is not required for native Windows support.

## Managed n8n

Docker is the only Yagr-managed local n8n runtime.

Use:

```powershell
yagr n8n local install --docker
yagr n8n local start
yagr n8n local status
yagr n8n local stop
```

Custom local and cloud n8n instances remain supported through setup when you bring your own URL and API key.

## Shell Tools

Yagr command execution is platform-native:

- Windows uses PowerShell
- Linux and macOS use the current POSIX shell

Do not rely on Git Bash for native Windows usage. Commands written for `runScript` or `runShell` should use syntax valid for the active platform.

## Troubleshooting

If Docker commands fail, start Docker Desktop and wait until the engine is ready, then run `yagr n8n doctor`.

If Docker-managed n8n cannot reach the local relay, check that Docker Desktop supports `host.docker.internal`. Yagr uses that path first for Docker relay connectivity.

If a tunnel or background service looks stale, run:

```powershell
yagr stop
yagr n8n tunnel status
```

If `cloudflared` is missing, run:

```powershell
yagr n8n tunnel setup
```
