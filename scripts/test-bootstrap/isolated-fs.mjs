/**
 * Filesystem + n8nac primitives for isolated YAGR_HOME test workspaces.
 * Orchestration order is defined by YAML profiles (see runner.mjs).
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { getDefaultBaseUrlForProvider } from '../../dist/llm/provider-registry.js';

/** @typedef {{
 *   host?: string,
 *   apiKey?: string,
 *   projectId?: string,
 *   instanceProfile?: 'yagr-managed-docker' | 'yagr-managed-direct' | 'custom-local-docker' | 'custom-local-direct' | 'custom-cloud',
 *   instanceIdentifier?: string,
 * }} TestN8nRuntime */

export function getIsolatedWorkspaceDir(homeDir) {
  return path.join(homeDir, 'n8n-workspace');
}

export function resolveN8nacCliPackage() {
  const version = String(process.env.YAGR_N8NAC_VERSION || '').trim();
  if (!version) {
    return 'n8nac@next';
  }
  return version.startsWith('@') ? `n8nac${version}` : `n8nac@${version}`;
}

export function normalizeHost(host) {
  try {
    return new URL(host).origin;
  } catch {
    return String(host || '').trim().replace(/\/$/, '');
  }
}

export function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function copyIfExists(source, destination) {
  if (!source || !fs.existsSync(source)) {
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

export function writeIsolatedN8nCredentials(homeDir, testN8nRuntime = {}) {
  const host = String(testN8nRuntime.host || '').trim();
  const apiKey = String(testN8nRuntime.apiKey || '').trim();
  if (!host || !apiKey) {
    return;
  }

  const normalizedHost = normalizeHost(host);
  const credentialsPath = path.join(homeDir, 'n8n-credentials.json');
  const payload = { hosts: { [normalizedHost]: apiKey } };
  fs.writeFileSync(credentialsPath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function writeIsolatedYagrConfig(tempHome, provider, model) {
  const configPath = path.join(tempHome, 'yagr-config.json');
  const baseUrlEnvKey = `YAGR_${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BASE_URL`;
  const baseUrl = String(process.env[baseUrlEnvKey] || '').trim() || getDefaultBaseUrlForProvider(provider);
  const localConfig = {
    provider,
    model,
    ...(baseUrl ? { baseUrl } : {}),
  };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(localConfig, null, 2)}\n`);
}

export function seedHomeAgentsMd(homeDir) {
  const destPath = path.join(homeDir, 'AGENTS.md');
  if (fs.existsSync(destPath)) {
    return;
  }

  const launchDir = process.env.YAGR_LAUNCH_CWD || process.cwd();
  const candidates = [
    path.join(launchDir, 'node_modules', '@yagr', 'manager-tooling', 'YAGENTS.md'),
    path.join(launchDir, 'src', 'manager-tooling', 'YAGENTS.md'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const content = fs.readFileSync(candidate, 'utf8').trim();
        if (content) {
          fs.writeFileSync(destPath, `${content}\n`);
        }
      } catch {
        // Best effort only.
      }
      return;
    }
  }
}

/**
 * @returns {{ ok: boolean, workspaceDir: string }}
 */
export function generateTestAgentsMd(homeDir, testN8nRuntime = {}, options = {}) {
  const { onUpdateAiFailure, afterSuccess } = options;
  const workspaceDir = getIsolatedWorkspaceDir(homeDir);
  const n8nacPackage = resolveN8nacCliPackage();

  const sharedEnv = {
    ...process.env,
    ...(testN8nRuntime.host ? { N8N_HOST: String(testN8nRuntime.host) } : {}),
    ...(testN8nRuntime.apiKey ? { N8N_API_KEY: String(testN8nRuntime.apiKey) } : {}),
    ...(testN8nRuntime.projectId ? { N8N_PROJECT_ID: String(testN8nRuntime.projectId) } : {}),
  };

  if (testN8nRuntime.host && testN8nRuntime.apiKey) {
    spawnSync(
      'npx',
      ['--yes', n8nacPackage, 'init-auth', '--host', String(testN8nRuntime.host), '--api-key', String(testN8nRuntime.apiKey)],
      {
        cwd: workspaceDir,
        env: sharedEnv,
        stdio: 'pipe',
        encoding: 'utf8',
      },
    );
  }

  const result = spawnSync('npx', ['--yes', n8nacPackage, 'update-ai', '--silent'], {
    cwd: workspaceDir,
    env: sharedEnv,
    stdio: 'pipe',
    encoding: 'utf8',
  });

  if ((result.status ?? 1) !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    const message = `Warning: n8nac update-ai failed for ${homeDir}: ${stderr || stdout || `exit ${result.status ?? 1}`}`;
    onUpdateAiFailure?.(message);
    return { ok: false, workspaceDir };
  }

  afterSuccess?.(workspaceDir);
  return { ok: true, workspaceDir };
}

export function appendYagrScenarioTestWorkspaceClarification(n8nWorkspaceDir) {
  const agentsPath = path.join(n8nWorkspaceDir, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    return;
  }
  const clarificationMarker = '<!-- yagr-test-clarification-start -->';
  const yagrWorkspaceClarification =
    '\n\n<!-- yagr-test-clarification-start -->\n## Yagr Test Workspace Clarification\n\n'
    + 'In Yagr integration tests, the n8n workspace root is the current directory where you are running commands.\n'
    + '- During these tests, your cwd is already `./n8n-workspace`.\n'
    + '- Therefore, when generic n8nac instructions say "look for `n8nac-config.json` in the workspace root", they mean the current directory.\n'
    + '- Do not go back to the Yagr home root to initialize n8nac. Reuse the existing `n8nac-config.json` in the current directory when it is present and complete.\n'
    + '<!-- yagr-test-clarification-end -->\n';

  const existingAgents = fs.readFileSync(agentsPath, 'utf8');
  if (!existingAgents.includes(clarificationMarker)) {
    fs.writeFileSync(agentsPath, `${existingAgents.trimEnd()}${yagrWorkspaceClarification}`);
  }
}

export function reconcileWorkflowDirs(n8nWorkspaceDir) {
  const configPath = path.join(n8nWorkspaceDir, 'n8nac-config.json');
  if (!fs.existsSync(configPath)) {
    return;
  }
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const workflowDir = config.workflowDir;
    if (workflowDir) {
      fs.mkdirSync(path.join(n8nWorkspaceDir, workflowDir), { recursive: true });
    }
    const provisionalDir = path.join(n8nWorkspaceDir, 'workflows', 'test');
    if (fs.existsSync(provisionalDir) && workflowDir && !String(workflowDir).startsWith('workflows/test')) {
      fs.rmSync(provisionalDir, { recursive: true, force: true });
    }
  } catch {
    // best effort
  }
}

export function initializeTestN8nConfig(n8nWorkspaceDir, testN8nRuntime = {}) {
  const configPath = path.join(n8nWorkspaceDir, 'n8nac-config.json');
  const host = String(testN8nRuntime.host || '').trim() || 'http://127.0.0.1:5678';
  const projectId = String(testN8nRuntime.projectId || '').trim() || 'personal';
  const projectName = projectId === 'personal' ? 'Personal' : projectId;
  const instanceProfile = String(testN8nRuntime.instanceProfile || '').trim() || undefined;
  const instanceIdentifier = String(testN8nRuntime.instanceIdentifier || '').trim()
    || (instanceProfile?.startsWith('yagr-managed-') ? 'yagr-managed' : 'test');

  const config = {
    version: 2,
    activeInstanceId: 'test-local',
    instances: [
      {
        id: 'test-local',
        name: 'test-local',
        host,
        syncFolder: 'workflows',
        projectId,
        projectName,
        instanceIdentifier,
        ...(instanceProfile ? { instanceProfile } : {}),
        verification: {
          status: 'verified',
          normalizedHost: host,
          userId: 'test-user',
          userName: 'test-user',
          userEmail: 'test@local.yagr',
          lastCheckedAt: new Date().toISOString(),
        },
      },
    ],
    host,
    syncFolder: 'workflows',
    projectId,
    projectName,
    instanceIdentifier,
    ...(instanceProfile ? { instanceProfile } : {}),
  };

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const workflowDir = path.join(n8nWorkspaceDir, 'workflows', 'test', projectId.toLowerCase().replace(/\s+/g, '-'));
  fs.mkdirSync(workflowDir, { recursive: true });
}

export function ensureIsolatedHomeProjectCompatibility(homeDir) {
  const workspaceDir = path.join(homeDir, 'n8n-workspace');
  const workspaceConfigPath = path.join(workspaceDir, 'n8nac-config.json');
  const rootConfigPath = path.join(homeDir, 'n8nac-config.json');
  const workspaceWorkflowsDir = path.join(workspaceDir, 'workflows');
  const rootWorkflowsDir = path.join(homeDir, 'workflows');

  const config = readJsonIfExists(workspaceConfigPath);
  if (config) {
    fs.writeFileSync(rootConfigPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  try {
    if (fs.existsSync(rootWorkflowsDir)) {
      const stat = fs.lstatSync(rootWorkflowsDir);
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        fs.rmSync(rootWorkflowsDir, { recursive: true, force: true });
      }
    }
    fs.symlinkSync(workspaceWorkflowsDir, rootWorkflowsDir, 'dir');
  } catch {
    fs.mkdirSync(rootWorkflowsDir, { recursive: true });
  }
}

/**
 * @param {{ tempBaseDir: string, provider: string }} ctx
 */
export function allocateIsolatedTempHome(ctx) {
  const baseDir = path.join(os.tmpdir(), ctx.tempBaseDir);
  fs.mkdirSync(baseDir, { recursive: true });
  const slug = `${String(ctx.provider).replace(/[^a-z0-9]+/gi, '-')}-`;
  return fs.mkdtempSync(path.join(baseDir, slug));
}
