# Agent Skills

Yagr supports standard Agent Skills: directories containing a `SKILL.md` file.

Yagr keeps this integration minimal. It installs, lists, removes, and exposes skill source paths. DeepAgents.js provides the runtime `SkillsMiddleware`, metadata discovery, prompt injection, and progressive disclosure.

## Commands

```bash
yagr skills list
yagr skills install <source>
yagr skills remove <name>
yagr skills path
```

Install globally by default:

```bash
yagr skills install ./my-skill
```

Install for the current workspace/context root:

```bash
yagr skills install ./my-skill --scope workspace
```

## Storage

Global skills are stored in:

```text
<YAGR_HOME>/skills
```

Workspace skills are stored in:

```text
<contextRoot>/.agents/skills
```

At runtime, Yagr passes skill sources to DeepAgents.js in this order:

```text
<YAGR_HOME>/skills
<contextRoot>/.agents/skills
```

DeepAgents.js uses `last wins`, so workspace skills override global skills with the same name.

## External Tool Skills

Yagr has no built-in domain tool logic. Tool-specific behavior should come from ordinary Agent Skills, local project files, or future plugins.

From a local development checkout:

```bash
yagr skills install /home/user/repos/example-tool/packages/skills/src/agent-skills
```

From a local build output:

```bash
yagr skills install /home/user/repos/example-tool/packages/skills/dist/agent-skills
```

From a published package:

```bash
yagr skills install npm:@example/agent-skills@latest
```

Yagr only installs and exposes skill directories. Commands referenced by those skills must already be available in the user environment.
