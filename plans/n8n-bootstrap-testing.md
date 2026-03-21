# N8N Bootstrap Testing Strategy

## Goal

Validate Yagr's n8n bootstrap behavior across:

- Linux, Windows, and macOS
- Docker available or unavailable
- Node.js available, unsupported, or unavailable
- clean and polluted developer environments

## Test Pyramid

### 1. Pure planner tests

Test deterministic decision logic without touching the host machine:

- strategy selection
- automation level selection
- fallback rules
- port and URL planning

These should remain the main source of confidence.

### 2. Linux integration tests in containers

Use `testcontainers` to execute Yagr inside clean Linux containers and validate:

- environment detection
- bootstrap diagnostics
- runtime planning in clean images

These tests should never depend on the developer host being clean.

### 3. Real OS CI matrix

Run unit tests on:

- `ubuntu-latest`
- `windows-latest`
- `macos-latest`

This catches path, shell, and process assumptions that Docker cannot model away.

### 4. Optional manual lab environments

Use heavyweight environments such as `Docker-OSX` only for exploration and manual validation, not as the foundation of the main CI pipeline.

## Current Implementation

- pure local bootstrap detection: `src/n8n-local/detect.ts`
- pure bootstrap planning: `src/n8n-local/plan.ts`
- unit tests: `tests/n8n-local-detect.test.mjs`, `tests/n8n-local-plan.test.mjs`
- Linux integration test: `tests/integration/n8n-local-doctor.test.mjs`
- CI matrix: `.github/workflows/ci.yml`

## Next Steps

1. Add table-driven planner tests for more bootstrap scenarios.
2. Add integration cases for occupied ports and missing Node.
3. Add assisted-flow UI tests once the wizard path exists.
4. Add real bootstrap install tests once Docker/direct runtime provisioning is implemented.
