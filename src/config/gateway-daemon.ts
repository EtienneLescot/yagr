import fs from 'node:fs';
import path from 'node:path';
import { getYagrHomeDir } from './yagr-home.js';

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

export function isYagrGatewayProcess(pid: number): boolean {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    return stat.includes('yagr') && stat.includes('gateway');
  } catch {
    return false;
  }
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

  try {
    process.kill(pid, 0);
    if (!isYagrGatewayProcess(pid)) {
      clearGatewayPid();
      return { running: false };
    }
    return { running: true, pid };
  } catch {
    clearGatewayPid();
    return { running: false };
  }
}
