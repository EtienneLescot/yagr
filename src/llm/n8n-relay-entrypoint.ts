#!/usr/bin/env node
/**
 * Standalone entrypoint for the Yagr n8n LLM relay server.
 * Launched as a detached child process by ensureN8nRelayServer().
 * Inherits YAGR_HOME / YAGR_LAUNCH_CWD from the parent environment.
 */
import '../config/init-yagr-home.js';
import { ensureN8nRelayServerInProcess } from './n8n-relay-server.js';

await ensureN8nRelayServerInProcess();
// Keep the process alive indefinitely — it is a long-lived daemon.
