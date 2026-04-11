import { loadProfileFromPath, normalizePhaseEntry, resolveDefaultProfilePath } from './load-profile.mjs';
import { AGENT_PREP_PHASE_HANDLERS, HOME_PHASE_HANDLERS } from './phase-handlers.mjs';
import { getIsolatedWorkspaceDir } from './isolated-fs.mjs';

/**
 * @typedef {import('./load-profile.mjs').BootstrapProfile} BootstrapProfile
 * @typedef {import('./phase-handlers.mjs').BootstrapContext} BootstrapContext
 */

/** @typedef {{ phaseId: string, status: 'ok'|'skip'|'fail', durationMs: number, reason?: string, error?: string }} BootstrapJournalEntry */

function stamp() {
  return `[${new Date().toISOString().slice(11, 19)}]`;
}

/**
 * @param {BootstrapContext} ctx
 * @param {string} message
 */
function logVerbose(ctx, message) {
  if (ctx.verbose || process.env.YAGR_TEST_BOOTSTRAP_LOG === '1') {
    process.stdout.write(`${stamp()} [bootstrap] ${message}\n`);
  }
}

/**
 * @param {import('./load-profile.mjs').NormalizedPhaseRef} ref
 * @param {BootstrapContext} ctx
 */
function shouldRunPhase(ref, ctx) {
  if (!ref.when) {
    return true;
  }
  if (ref.when === 'n8n_required') {
    return Boolean(ctx.n8nRequired);
  }
  return true;
}

/**
 * @param {string | BootstrapProfile} profilePathOrObject
 * @param {Omit<BootstrapContext, 'homeDir'|'profile'> & { profilePath?: string }} partialCtx
 * @returns {Promise<{ homeDir: string, workspaceDir: string, journal: BootstrapJournalEntry[], profile: BootstrapProfile }>}
 */
export async function runHomeBootstrap(profilePathOrObject, partialCtx) {
  const profile = typeof profilePathOrObject === 'string'
    ? loadProfileFromPath(profilePathOrObject)
    : profilePathOrObject;

  /** @type {BootstrapContext} */
  const ctx = {
    ...partialCtx,
    profile,
    homeDir: undefined,
  };

  const journal = [];

  for (const raw of profile.homePhases) {
    const ref = normalizePhaseEntry(raw);
    if (!shouldRunPhase(ref, ctx)) {
      journal.push({ phaseId: ref.id, status: 'skip', durationMs: 0, reason: 'when' });
      logVerbose(ctx, `home phase ${ref.id}: skip (when)`);
      continue;
    }
    const handler = HOME_PHASE_HANDLERS[ref.id];
    if (!handler) {
      throw new Error(`No handler for home phase: ${ref.id}`);
    }
    const t0 = Date.now();
    logVerbose(ctx, `home phase ${ref.id}: start`);
    try {
      await Promise.resolve(handler(ctx));
      const durationMs = Date.now() - t0;
      journal.push({ phaseId: ref.id, status: 'ok', durationMs });
      logVerbose(ctx, `home phase ${ref.id}: ok (${durationMs}ms)`);
    } catch (err) {
      const durationMs = Date.now() - t0;
      const message = err instanceof Error ? err.message : String(err);
      journal.push({ phaseId: ref.id, status: 'fail', durationMs, error: message });
      logVerbose(ctx, `home phase ${ref.id}: fail — ${message}`);
      throw err;
    }
  }

  if (!ctx.homeDir) {
    throw new Error('Home bootstrap finished without allocate_temp_home');
  }

  return {
    homeDir: ctx.homeDir,
    workspaceDir: getIsolatedWorkspaceDir(ctx.homeDir),
    journal,
    profile,
  };
}

/**
 * @param {string | BootstrapProfile} profilePathOrObject
 * @param {BootstrapContext} ctx - must include homeDir, profile
 * @returns {Promise<BootstrapJournalEntry[]>}
 */
export async function runAgentPrepPhases(profilePathOrObject, ctx) {
  const profile = typeof profilePathOrObject === 'string'
    ? loadProfileFromPath(profilePathOrObject)
    : profilePathOrObject;

  const execCtx = { ...ctx, profile };
  const journal = [];
  const phases = profile.agentPrepPhases ?? [];

  for (const raw of phases) {
    const ref = normalizePhaseEntry(raw);
    if (!shouldRunPhase(ref, execCtx)) {
      journal.push({ phaseId: ref.id, status: 'skip', durationMs: 0, reason: 'when' });
      logVerbose(execCtx, `agent-prep ${ref.id}: skip (when)`);
      continue;
    }
    const handler = AGENT_PREP_PHASE_HANDLERS[ref.id];
    if (!handler) {
      throw new Error(`No handler for agent-prep phase: ${ref.id}`);
    }
    const t0 = Date.now();
    logVerbose(execCtx, `agent-prep ${ref.id}: start`);
    try {
      await handler(execCtx);
      const durationMs = Date.now() - t0;
      journal.push({ phaseId: ref.id, status: 'ok', durationMs });
      logVerbose(execCtx, `agent-prep ${ref.id}: ok (${durationMs}ms)`);
    } catch (err) {
      const durationMs = Date.now() - t0;
      const message = err instanceof Error ? err.message : String(err);
      journal.push({ phaseId: ref.id, status: 'fail', durationMs, error: message });
      logVerbose(execCtx, `agent-prep ${ref.id}: fail — ${message}`);
      throw err;
    }
  }

  return journal;
}

export function defaultProfilePath(profileFileName) {
  return resolveDefaultProfilePath(profileFileName);
}
