---
sidebar_position: 6
title: Claude Plugin Privacy Policy
description: Privacy policy for the n8n-as-code Claude plugin.
---

# Claude Plugin Privacy Policy

This page describes how the `n8n-as-code` Claude plugin handles data.

## Scope

This policy applies to the `n8n-as-code` Claude plugin published from the following repository:

```text
https://github.com/EtienneLescot/n8n-as-code
```

It covers the plugin package, bundled skill files, and the `n8nac` CLI usage described in this project documentation.

## Summary

- The plugin is designed to run locally in the user's Claude environment.
- The project does not provide a hosted backend service for plugin execution.
- Workflow files, prompts, and configuration are intended to stay in the user's local workspace and their own n8n instance.
- The project author does not intentionally collect workflow content, prompts, credentials, or n8n data through the plugin itself.

## Data the Plugin May Access

Depending on how the user works, the plugin may access:

- local workflow files in the current workspace
- local project configuration such as `n8nac-config.json`
- n8n workflow metadata and workflow definitions fetched from the user's own n8n instance
- user prompts and instructions entered into Claude

This access is necessary for creating, updating, validating, and pushing workflows.

## How Data Is Used

The plugin uses data only to perform the workflow engineering tasks requested by the user, such as:

- checking whether the workspace is initialized
- listing, pulling, editing, validating, and pushing workflows
- searching node schemas and local knowledge files
- generating or updating local `.workflow.ts` files

## Data Sharing

The plugin itself is not designed to send user data to a service operated by the project author.

Data may still be processed by third-party services the user explicitly uses, including:

- Anthropic services used to run Claude
- the user's own n8n instance
- repositories or external APIs the user connects during workflow execution

Those services are governed by their own terms and privacy policies.

## Credentials and Secrets

Users are responsible for the credentials they configure in their own environment, including n8n API keys and any credentials stored in n8n.

The plugin documentation recommends local, explicit initialization and does not require sending those credentials to the project author.

## Retention

The plugin does not provide a separate hosted storage layer operated by the project author.

Any retention of files, prompts, logs, or workflow metadata depends on:

- the user's local machine and repository
- the user's n8n instance
- Anthropic or other third-party services the user chooses to use

## Open Source

The plugin is distributed as open-source software under the Apache-2.0 license. The public source repository is available here:

```text
https://github.com/EtienneLescot/n8n-as-code
```

## Contact

For privacy questions related to this plugin submission, contact:

```text
etienne@etiennelescot.fr
```

## Updates

This policy may be updated as the plugin evolves. The latest public version is the one published in this documentation site.