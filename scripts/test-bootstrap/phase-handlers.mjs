import fs from 'node:fs';
import {
  allocateIsolatedTempHome,
  appendYagrScenarioTestWorkspaceClarification,
  ensureIsolatedHomeProjectCompatibility,
  generateTestAgentsMd,
  getIsolatedWorkspaceDir,
  initializeTestN8nConfig,
  reconcileWorkflowDirs,
  seedHomeAgentsMd,
  writeIsolatedN8nCredentials,
  writeIsolatedYagrConfig,
} from './isolated-fs.mjs';

/**
 * @typedef {import('./load-profile.mjs').BootstrapProfile} BootstrapProfile
 * @typedef {{
 *   homeDir?: string,
 *   provider: string,
 *   model: string,
 *   testN8nRuntime: { host?: string, apiKey?: string, projectId?: string },
 *   useManagedDocker: boolean,
 *   verbose: boolean,
 *   n8nRequired?: boolean,
 *   agentsMd: { onUpdateAiFailure?: (msg: string) => void },
 *   profile?: BootstrapProfile,
 * }} BootstrapContext
 */

/** @param {BootstrapContext} ctx */
export function phaseAllocateTempHome(ctx) {
  const tempBaseDir = ctx.profile.temp.baseDir;
  ctx.homeDir = allocateIsolatedTempHome({ tempBaseDir, provider: ctx.provider });
}

/** @param {BootstrapContext} ctx */
export function phaseWriteYagrLlmConfig(ctx) {
  if (!ctx.homeDir) throw new Error('allocate_temp_home must run first');
  writeIsolatedYagrConfig(ctx.homeDir, ctx.provider, ctx.model);
}

/** @param {BootstrapContext} ctx */
export function phaseInitN8nWorkspace(ctx) {
  if (!ctx.homeDir) throw new Error('allocate_temp_home must run first');
  const n8nWorkspaceDir = getIsolatedWorkspaceDir(ctx.homeDir);
  fs.mkdirSync(n8nWorkspaceDir, { recursive: true });
  initializeTestN8nConfig(n8nWorkspaceDir, ctx.testN8nRuntime);
}

/** @param {BootstrapContext} ctx */
export function phaseWorkspaceSymlinkCompat(ctx) {
  if (!ctx.homeDir) throw new Error('allocate_temp_home must run first');
  ensureIsolatedHomeProjectCompatibility(ctx.homeDir);
}

/** @param {BootstrapContext} ctx */
export function phaseWriteN8nHostCredentials(ctx) {
  if (!ctx.homeDir) throw new Error('allocate_temp_home must run first');
  writeIsolatedN8nCredentials(ctx.homeDir, ctx.testN8nRuntime);
}

/** @param {BootstrapContext} ctx */
export function phaseSeedHomeAgentsMd(ctx) {
  if (!ctx.homeDir) throw new Error('allocate_temp_home must run first');
  seedHomeAgentsMd(ctx.homeDir);
}

/** @param {BootstrapContext} ctx */
export function phaseN8nacInitAuthAndAgentsMd(ctx) {
  if (!ctx.homeDir) throw new Error('allocate_temp_home must run first');
  generateTestAgentsMd(ctx.homeDir, ctx.testN8nRuntime, {
    onUpdateAiFailure: ctx.agentsMd.onUpdateAiFailure,
  });
}

/** @param {BootstrapContext} ctx */
export function phaseAppendScenarioN8nWorkspaceNote(ctx) {
  if (!ctx.homeDir) throw new Error('allocate_temp_home must run first');
  appendYagrScenarioTestWorkspaceClarification(getIsolatedWorkspaceDir(ctx.homeDir));
}

/** @param {BootstrapContext} ctx */
export function phaseReconcileN8nacWorkflowDirs(ctx) {
  if (!ctx.homeDir) throw new Error('allocate_temp_home must run first');
  reconcileWorkflowDirs(getIsolatedWorkspaceDir(ctx.homeDir));
}

/** @param {BootstrapContext} ctx */
export async function phaseLlmProxyOnboarding(ctx) {
  if (!ctx.homeDir) throw new Error('homeDir required for llm_proxy_onboarding');
  const host = String(ctx.testN8nRuntime?.host || '').trim();
  if (!host) {
    return;
  }
  const { YagrSetupApplicationService } = await import('../../dist/setup/application-services.js');
  const { YagrConfigService } = await import('../../dist/config/yagr-config-service.js');
  const { YagrN8nConfigService } = await import('../../dist/config/n8n-config-service.js');
  const yagrConfig = new YagrConfigService();
  const n8nConfig = new YagrN8nConfigService();
  const setup = new YagrSetupApplicationService(yagrConfig, n8nConfig);
  const instanceProfile = ctx.testN8nRuntime?.instanceProfile
    ?? (ctx.useManagedDocker ? 'yagr-managed-docker' : undefined);
  const result = await setup.setupLlmProxy(host, instanceProfile);
  setup.saveLlmProxyConfig({
    enabled: true,
    mode: result.mode,
    credentialBaseUrl: result.credentialBaseUrl,
    ...(result.dockerHostAddress ? { dockerHostAddress: result.dockerHostAddress } : {}),
    ...(result.llmTunnelUrl ? { llmTunnelUrl: result.llmTunnelUrl } : {}),
  });
  await setup.provisionLlmProxyCredential();
}

export const HOME_PHASE_HANDLERS = {
  allocate_temp_home: phaseAllocateTempHome,
  write_yagr_llm_config: phaseWriteYagrLlmConfig,
  init_n8n_workspace: phaseInitN8nWorkspace,
  workspace_symlink_compat: phaseWorkspaceSymlinkCompat,
  write_n8n_host_credentials: phaseWriteN8nHostCredentials,
  seed_home_agents_md: phaseSeedHomeAgentsMd,
  n8nac_init_auth_and_agents_md: phaseN8nacInitAuthAndAgentsMd,
  append_scenario_n8n_workspace_note: phaseAppendScenarioN8nWorkspaceNote,
  reconcile_n8nac_workflow_dirs: phaseReconcileN8nacWorkflowDirs,
};

export const AGENT_PREP_PHASE_HANDLERS = {
  llm_proxy_onboarding: phaseLlmProxyOnboarding,
};
