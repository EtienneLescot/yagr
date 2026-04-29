import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_FILE_SIZE,
  MAX_SKILL_NAME_LENGTH,
  parseSkillMetadata,
  type LoaderSkillMetadata,
} from 'deepagents';
import { getYagrLaunchDir, getYagrSkillsDir, getYagrWorkspaceSkillsDir } from '../config/yagr-home.js';

export type YagrSkillScope = 'global' | 'workspace';

export interface YagrSkillRoot {
  scope: YagrSkillScope;
  path: string;
  priority: number;
}

export interface YagrAgentSkillRecord extends LoaderSkillMetadata {
  scope: YagrSkillScope;
  rootPath: string;
  skillDir: string;
  effective: boolean;
  overriddenBy?: string;
}

export interface InstallAgentSkillsOptions {
  scope?: YagrSkillScope;
  contextRoot?: string;
  sourceLabel?: string;
}

export interface ListAgentSkillsOptions {
  contextRoot?: string;
}

export interface RemoveAgentSkillOptions {
  scope?: YagrSkillScope;
  contextRoot?: string;
}

export interface DeepAgentSkillSourcePathOptions {
  contextRoot?: string;
  includeEmpty?: boolean;
}

const SKILL_FILE_NAME = 'SKILL.md';
const REMOTE_CANDIDATE_ROOTS = [
  '.',
  'skills',
  'agent-skills',
  path.join('dist', 'skills'),
  path.join('dist', 'agent-skills'),
  path.join('.agents', 'skills'),
];

function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith(`~${path.sep}`) || input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function resolveLocalCandidate(source: string): string {
  const expanded = expandHome(source);
  return path.isAbsolute(expanded) ? expanded : path.resolve(getYagrLaunchDir(), expanded);
}

function isExplicitLocalSource(source: string): boolean {
  if (source.startsWith('.') || source.startsWith('/') || source.startsWith('~')) return true;
  if (/^[A-Za-z]:[\\/]/.test(source)) return true;
  if (source.includes('\\')) return true;
  if (source.includes('/') && !source.startsWith('@') && !/^[a-z][a-z0-9+.-]*:/i.test(source)) return true;
  return false;
}

function toDeepAgentPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function deepagentsSource(scope: YagrSkillScope): 'user' | 'project' {
  return scope === 'global' ? 'user' : 'project';
}

function validateSkillName(name: string, directoryName: string): string | undefined {
  if (!name) return 'name is required';
  if (name.length > MAX_SKILL_NAME_LENGTH) return `name exceeds ${MAX_SKILL_NAME_LENGTH} characters`;
  if (name.startsWith('-') || name.endsWith('-') || name.includes('--')) {
    return 'name must be lowercase alphanumeric with single hyphens only';
  }
  for (const c of name) {
    if (c === '-') continue;
    if (/\p{Ll}/u.test(c) || /\p{Nd}/u.test(c)) continue;
    return 'name must be lowercase alphanumeric with single hyphens only';
  }
  if (name !== directoryName) return `name '${name}' must match directory name '${directoryName}'`;
  return undefined;
}

function parseAndValidateSkill(skillDir: string, scope: YagrSkillScope): LoaderSkillMetadata {
  const skillMdPath = path.join(skillDir, SKILL_FILE_NAME);
  if (!fs.existsSync(skillMdPath)) {
    throw new Error(`Missing ${SKILL_FILE_NAME}: ${skillDir}`);
  }
  const stat = fs.statSync(skillMdPath);
  if (!stat.isFile()) {
    throw new Error(`${SKILL_FILE_NAME} is not a file: ${skillMdPath}`);
  }
  if (stat.size > MAX_SKILL_FILE_SIZE) {
    throw new Error(`${SKILL_FILE_NAME} exceeds ${MAX_SKILL_FILE_SIZE} bytes: ${skillMdPath}`);
  }
  const metadata = parseSkillMetadata(skillMdPath, deepagentsSource(scope));
  if (!metadata) {
    throw new Error(`Invalid ${SKILL_FILE_NAME}: ${skillMdPath}`);
  }
  if (!metadata.description || metadata.description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    throw new Error(`Invalid skill description in ${skillMdPath}`);
  }
  const directoryName = path.basename(skillDir);
  const nameError = validateSkillName(metadata.name, directoryName);
  if (nameError) {
    throw new Error(`Invalid skill name in ${skillMdPath}: ${nameError}`);
  }
  return metadata;
}

function hasSkillFile(directoryPath: string): boolean {
  return fs.existsSync(path.join(directoryPath, SKILL_FILE_NAME));
}

function hasChildSkill(directoryPath: string): boolean {
  try {
    if (!fs.existsSync(directoryPath)) return false;
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    return entries.some((entry) => entry.isDirectory() && hasSkillFile(path.join(directoryPath, entry.name)));
  } catch {
    return false;
  }
}

function listSkillDirectories(collectionRoot: string): string[] {
  if (!fs.existsSync(collectionRoot)) return [];
  const rootStat = fs.statSync(collectionRoot);
  if (!rootStat.isDirectory()) return [];
  if (hasSkillFile(collectionRoot)) return [collectionRoot];
  const entries = fs.readdirSync(collectionRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(collectionRoot, entry.name))
    .filter((entryPath) => hasSkillFile(entryPath))
    .sort((a, b) => a.localeCompare(b));
}

function findInstallableSkillDirectories(sourceRoot: string): string[] {
  const found = new Map<string, string>();
  for (const relativeRoot of REMOTE_CANDIDATE_ROOTS) {
    const candidateRoot = path.resolve(sourceRoot, relativeRoot);
    for (const skillDir of listSkillDirectories(candidateRoot)) {
      const key = path.resolve(skillDir);
      if (!found.has(key)) found.set(key, skillDir);
    }
  }
  return Array.from(found.values());
}

async function copyDirectoryRejectingSymlinks(sourceDir: string, targetDir: string): Promise<void> {
  const stat = await fsPromises.lstat(sourceDir);
  if (stat.isSymbolicLink()) throw new Error(`Refusing to install symlinked skill path: ${sourceDir}`);
  if (!stat.isDirectory()) throw new Error(`Expected directory: ${sourceDir}`);
  await fsPromises.mkdir(targetDir, { recursive: true });
  const entries = await fsPromises.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing to install symlink inside skill: ${sourcePath}`);
    if (entry.isDirectory()) {
      await copyDirectoryRejectingSymlinks(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fsPromises.copyFile(sourcePath, targetPath);
    }
  }
}

async function installSkillDirectory(skillDir: string, targetRoot: string, scope: YagrSkillScope): Promise<YagrAgentSkillRecord> {
  const metadata = parseAndValidateSkill(skillDir, scope);
  await fsPromises.mkdir(targetRoot, { recursive: true });
  const tmpDir = path.join(targetRoot, `.tmp-${metadata.name}-${process.pid}-${Date.now()}`);
  const finalDir = path.join(targetRoot, metadata.name);
  await fsPromises.rm(tmpDir, { recursive: true, force: true });
  await copyDirectoryRejectingSymlinks(skillDir, tmpDir);
  await fsPromises.rm(finalDir, { recursive: true, force: true });
  await fsPromises.rename(tmpDir, finalDir);
  return {
    ...metadata,
    path: path.join(finalDir, SKILL_FILE_NAME),
    scope,
    rootPath: targetRoot,
    skillDir: finalDir,
    effective: true,
  };
}

async function extractRemoteSource(source: string, destination: string): Promise<void> {
  const pacote = await import('pacote');
  await pacote.extract(source, destination, { ignoreScripts: true });
}

export function resolveAgentSkillRoots(options: ListAgentSkillsOptions = {}): YagrSkillRoot[] {
  const contextRoot = options.contextRoot ?? getYagrLaunchDir();
  return [
    { scope: 'global', path: getYagrSkillsDir(), priority: 0 },
    { scope: 'workspace', path: getYagrWorkspaceSkillsDir(contextRoot), priority: 1 },
  ];
}

export function resolveAgentSkillInstallDir(scope: YagrSkillScope = 'global', options: ListAgentSkillsOptions = {}): string {
  return scope === 'global'
    ? getYagrSkillsDir()
    : getYagrWorkspaceSkillsDir(options.contextRoot ?? getYagrLaunchDir());
}

export function getDeepAgentSkillSourcePaths(options: DeepAgentSkillSourcePathOptions = {}): string[] {
  return resolveAgentSkillRoots(options)
    .filter((root) => options.includeEmpty || hasChildSkill(root.path))
    .map((root) => toDeepAgentPath(root.path));
}

export function listAgentSkills(options: ListAgentSkillsOptions = {}): YagrAgentSkillRecord[] {
  const records: YagrAgentSkillRecord[] = [];
  const effectiveByName = new Map<string, YagrAgentSkillRecord>();
  for (const root of resolveAgentSkillRoots(options)) {
    for (const skillDir of listSkillDirectories(root.path)) {
      let metadata: LoaderSkillMetadata;
      try {
        metadata = parseAndValidateSkill(skillDir, root.scope);
      } catch {
        continue;
      }
      const previous = effectiveByName.get(metadata.name);
      if (previous) {
        previous.effective = false;
        previous.overriddenBy = root.scope;
      }
      const record: YagrAgentSkillRecord = {
        ...metadata,
        scope: root.scope,
        rootPath: root.path,
        skillDir,
        effective: true,
      };
      records.push(record);
      effectiveByName.set(metadata.name, record);
    }
  }
  return records;
}

export function getEffectiveAgentSkill(name: string, options: ListAgentSkillsOptions = {}): YagrAgentSkillRecord | undefined {
  return listAgentSkills(options).find((skill) => skill.name === name && skill.effective);
}

export const discoverAgentSkills = listAgentSkills;

export async function installAgentSkills(source: string, options: InstallAgentSkillsOptions = {}): Promise<YagrAgentSkillRecord[]> {
  const scope = options.scope ?? 'global';
  const targetRoot = resolveAgentSkillInstallDir(scope, options);
  const localCandidate = resolveLocalCandidate(source);
  let sourceRoot = localCandidate;
  let tempRoot: string | undefined;

  if (!fs.existsSync(localCandidate)) {
    if (isExplicitLocalSource(source)) {
      throw new Error(`Skill source not found: ${source}`);
    }
    tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'yagr-skills-'));
    await extractRemoteSource(source, tempRoot);
    sourceRoot = tempRoot;
  }

  try {
    const skillDirs = findInstallableSkillDirectories(sourceRoot);
    if (skillDirs.length === 0) {
      throw new Error(`No installable Agent Skills found in source: ${source}`);
    }
    const installed: YagrAgentSkillRecord[] = [];
    for (const skillDir of skillDirs) {
      installed.push(await installSkillDirectory(skillDir, targetRoot, scope));
    }
    return installed;
  } finally {
    if (tempRoot) {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  }
}

export async function removeAgentSkill(name: string, options: RemoveAgentSkillOptions = {}): Promise<{ name: string; scope: YagrSkillScope; removedPath: string; removed: boolean }> {
  const scope = options.scope ?? 'global';
  const nameError = validateSkillName(name, name);
  if (nameError) throw new Error(`Invalid skill name: ${nameError}`);
  const targetRoot = resolveAgentSkillInstallDir(scope, options);
  const removedPath = path.join(targetRoot, name);
  const removed = fs.existsSync(removedPath);
  await fsPromises.rm(removedPath, { recursive: true, force: true });
  return { name, scope, removedPath, removed };
}
