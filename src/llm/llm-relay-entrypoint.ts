#!/usr/bin/env node
/**
 * Standalone entrypoint for the Yagr LLM relay server.
 * Launched as a detached child process by ensureLlmRelayServer().
 * Inherits YAGR_HOME / YAGR_LAUNCH_CWD from the parent environment.
 */
import '../config/init-yagr-home.js';
import { ensureN8nRelayServerInProcess } from './llm-relay-server.js';

await ensureN8nRelayServerInProcess();
// Keep the process alive indefinitely — it is a long-lived daemon.
