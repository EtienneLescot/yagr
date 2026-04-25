import fs from 'node:fs';
import path from 'node:path';
import { getYagrHomeDir } from './yagr-home.js';
import { getProcessCommandLine, isPidAlive } from '../system/process.js';

export function getGatewayPidPath(): string {
  return path.join(getYagrHomeDir(), 'gateway.pid');
}

export function getGatewayLogPath(): string {
  return path.join(getYagrHomeDir(), 'gateway.log');
}

export function getGatewayLockPath(): string {
  return path.join(getYagrHomeDir(), 'gateway.lock');
}

export function writeGatewayPid(pid: number): void {
  fs.writeFileSync(getGatewayPidPath(), String(pid), 'utf8');
}

export function readGatewayPid(): number | undefined {
  try {
    const raw = fs.readFileSync(getGatewayPidPath(), 'utf8').trim();
    const pid = parseInt(raw, 10);
    return Number.isNaN(pid) ? undefined : pid;
  } catch {
    return undefined;
  }
}

export function clearGatewayPid(): void {
  try {
    fs.unlinkSync(getGatewayPidPath());
  } catch { /* already gone */ }
}

function hasCommandToken(commandLine: string, token: string): boolean {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s"'\\0])${escapedToken}($|[\\s"'\\0])`, 'i').test(commandLine);
}

export function isYagrGatewayCommandLine(commandLine: string | undefined): boolean {
  if (!commandLine) {
    return false;
  }

  const normalized = commandLine.replace(/\0/g, ' ').trim();
  return /(^|[\\/@\s"'-])@?yagr([\\/.\s"'_-]|$)/i.test(normalized)
    && hasCommandToken(normalized, 'gateway');
}

export function isYagrGatewayProcess(pid: number): boolean {
  return isYagrGatewayCommandLine(getProcessCommandLine(pid));
}

export function tryAcquireLock(): boolean {
  try {
    fs.mkdirSync(getGatewayLockPath(), { recursive: false, mode: 0o700 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    return false;
  }
}

export function releaseLock(): void {
  try {
    fs.rmdirSync(getGatewayLockPath());
  } catch { /* already gone */ }
}

export function isGatewayRunning(): { running: boolean; pid?: number } {
  const pid = readGatewayPid();
  if (pid === undefined) return { running: false };

  if (!isPidAlive(pid) || !isYagrGatewayProcess(pid)) {
    clearGatewayPid();
    return { running: false };
  }

  return { running: true, pid };
}
