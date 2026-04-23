import fs from 'node:fs';
import path from 'node:path';
import { getYagrHomeDir } from './yagr-home.js';
export function getGatewayPidPath() {
    return path.join(getYagrHomeDir(), 'gateway.pid');
}
export function getGatewayLogPath() {
    return path.join(getYagrHomeDir(), 'gateway.log');
}
export function getGatewayLockPath() {
    return path.join(getYagrHomeDir(), 'gateway.lock');
}
export function writeGatewayPid(pid) {
    fs.writeFileSync(getGatewayPidPath(), String(pid), 'utf8');
}
export function readGatewayPid() {
    try {
        const raw = fs.readFileSync(getGatewayPidPath(), 'utf8').trim();
        const pid = parseInt(raw, 10);
        return Number.isNaN(pid) ? undefined : pid;
    }
    catch {
        return undefined;
    }
}
export function clearGatewayPid() {
    try {
        fs.unlinkSync(getGatewayPidPath());
    }
    catch { /* already gone */ }
}
export function isYagrGatewayProcess(pid) {
    try {
        const stat = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        return stat.includes('yagr') && stat.includes('gateway');
    }
    catch {
        return false;
    }
}
export function tryAcquireLock() {
    try {
        fs.mkdirSync(getGatewayLockPath(), { recursive: false, mode: 0o700 });
        return true;
    }
    catch (error) {
        if (error.code === 'EEXIST') {
            return false;
        }
        return false;
    }
}
export function releaseLock() {
    try {
        fs.rmdirSync(getGatewayLockPath());
    }
    catch { /* already gone */ }
}
export function isGatewayRunning() {
    const pid = readGatewayPid();
    if (pid === undefined)
        return { running: false };
    try {
        process.kill(pid, 0);
        if (!isYagrGatewayProcess(pid)) {
            clearGatewayPid();
            return { running: false };
        }
        return { running: true, pid };
    }
    catch {
        clearGatewayPid();
        return { running: false };
    }
}
//# sourceMappingURL=gateway-daemon.js.map