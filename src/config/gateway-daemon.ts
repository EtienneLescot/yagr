import fs from 'node:fs';
import path from 'node:path';
import { getYagrHomeDir } from './yagr-home.js';

export function getGatewayPidPath(): string {
  return path.join(getYagrHomeDir(), 'gateway.pid');
}

export function getGatewayLogPath(): string {
  return path.join(getYagrHomeDir(), 'gateway.log');
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

export function isGatewayRunning(): { running: boolean; pid?: number } {
  const pid = readGatewayPid();
  if (pid === undefined) return { running: false };

  try {
    process.kill(pid, 0);
    return { running: true, pid };
  } catch {
    clearGatewayPid();
    return { running: false };
  }
}
