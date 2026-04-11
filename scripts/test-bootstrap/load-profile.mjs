import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const KNOWN_HOME_PHASE_IDS = [
  'allocate_temp_home',
  'write_yagr_llm_config',
  'init_n8n_workspace',
  'workspace_symlink_compat',
  'write_n8n_host_credentials',
  'seed_home_agents_md',
  'n8nac_init_auth_and_agents_md',
  'append_scenario_n8n_workspace_note',
  'reconcile_n8nac_workflow_dirs',
];

export const KNOWN_AGENT_PREP_PHASE_IDS = ['llm_proxy_onboarding'];

const whenSchema = z.enum(['n8n_required']);

const phaseEntrySchema = z.union([
  z.string().min(1),
  z.object({
    id: z.string().min(1),
    when: whenSchema.optional(),
  }),
]);

export const bootstrapProfileSchema = z.object({
  version: z.literal(1),
  profile: z.string().min(1),
  temp: z.object({
    baseDir: z.string().min(1),
  }),
  homePhases: z.array(phaseEntrySchema),
  agentPrepPhases: z.array(phaseEntrySchema).default([]),
});

/** @typedef {z.infer<typeof bootstrapProfileSchema>} BootstrapProfile */
/** @typedef {{ id: string, when?: z.infer<typeof whenSchema> }} NormalizedPhaseRef */

/**
 * @param {unknown} entry
 * @returns {NormalizedPhaseRef}
 */
export function normalizePhaseEntry(entry) {
  if (typeof entry === 'string') {
    return { id: entry.trim() };
  }
  return { id: String(entry.id).trim(), when: entry.when };
}

/**
 * @param {string} profileYamlPath
 * @returns {BootstrapProfile}
 */
export function loadProfileFromPath(profileYamlPath) {
  const raw = fs.readFileSync(profileYamlPath, 'utf8');
  const parsed = parseYaml(raw);
  const profile = bootstrapProfileSchema.parse(parsed);

  for (const p of profile.homePhases) {
    const { id } = normalizePhaseEntry(p);
    if (!KNOWN_HOME_PHASE_IDS.includes(id)) {
      throw new Error(`Unknown home phase "${id}" in ${profileYamlPath}`);
    }
  }
  for (const p of profile.agentPrepPhases) {
    const { id } = normalizePhaseEntry(p);
    if (!KNOWN_AGENT_PREP_PHASE_IDS.includes(id)) {
      throw new Error(`Unknown agent-prep phase "${id}" in ${profileYamlPath}`);
    }
  }
  return profile;
}

export function defaultProfilesDir() {
  return path.join(__dirname, 'profiles');
}

/**
 * @param {string} name - e.g. scenario-integration.yaml
 */
export function resolveDefaultProfilePath(name) {
  return path.join(defaultProfilesDir(), name);
}
