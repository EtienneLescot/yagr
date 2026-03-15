---
sidebar_position: 1
title: Usage
description: Guides for using n8n-as-code with VS Code, Claude, OpenClaw, and the CLI.
---

# Usage

n8n-as-code gives you several ways to work with your n8n workflows locally. Pick the one that fits your workflow best.

## VS Code Extension

The most complete experience. Install the extension in VS Code or Cursor, connect to your n8n instance, and manage everything from the sidebar.

- Tree view with sync status for every workflow
- Right-click to pull, push, or resolve conflicts
- Split view: code editor + n8n canvas side by side
- JSON validation and code snippets

[**VS Code Extension Guide →**](/docs/usage/vscode-extension)

## Claude Plugin

Let Claude create, edit, and fix workflows for you. Install the plugin in Claude Code or set up the MCP server for Claude Desktop — then just describe what you want.

- Natural language workflow creation and editing
- Automatic node lookup from 500+ schemas
- Handles init, pull, push behind the scenes

[**Claude Plugin Guide →**](/docs/usage/claude-plugin)

## OpenClaw Plugin

Same AI-powered workflow experience inside OpenClaw. Install the plugin, run the setup wizard, and ask for workflow changes in plain language.

[**OpenClaw Plugin Guide →**](/docs/usage/openclaw)

## CLI

The command-line interface for terminal users, scripts, and CI/CD pipelines. All sync operations available as explicit commands.

- `n8nac init` / `list` / `pull` / `push` / `resolve`
- Workflow format conversion (JSON ↔ TypeScript)
- AI context generation (`update-ai`)

[**CLI Guide →**](/docs/usage/cli)

## TypeScript Workflows

An optional decorator-based format that makes workflows more readable and AI-friendly. Works alongside the standard JSON format — convert back and forth at any time.

[**TypeScript Workflows Guide →**](/docs/usage/typescript-workflows)

## Common Commands Reference

| Action | VS Code | CLI |
|---|---|---|
| See workflow status | Tree view (auto) | `n8nac list` |
| Pull a workflow | Right-click → Pull | `n8nac pull <id>` |
| Push changes | Right-click → Push | `n8nac push <path>` |
| Resolve conflict | Expand workflow → action buttons | `n8nac resolve <id> --mode keep-current\|keep-incoming` |
| Generate AI context | Automatic on init | `n8nac update-ai` |
| Search workflows | Find Workflow (title bar) | `n8nac find <query>` |
