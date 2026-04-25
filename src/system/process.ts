import { spawn, execFile, spawnSync, type ChildProcess, type SpawnOptions, type ExecFileOptions } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ShellCommandSpec {
  file: string;
  args: string[];
}

export function resolveExecutableCommand(command: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32' && (command === 'npm' || command === 'npx')) {
    return `${command}.cmd`;
  }
  return command;
}

export function resolveNativeShell(platform: NodeJS.Platform = process.platform): ShellCommandSpec {
  if (platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command'],
    };
  }

  const configuredShell = process.env.SHELL;
  if (configuredShell) {
    const normalizedShell = configuredShell.split('/').pop()?.toLowerCase();
    if (normalizedShell && ['sh', 'bash', 'dash', 'ksh', 'zsh', 'ash'].includes(normalizedShell)) {
      return {
        file: configuredShell,
        args: ['-c'],
      };
    }
  }

  return {
    file: 'sh',
    args: ['-c'],
  };
}

export function spawnCommand(command: string, args: string[], options: SpawnOptions = {}): ChildProcess {
  const file = resolveExecutableCommand(command);
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
  return spawn(file, args, {
    ...options,
    shell: options.shell ?? needsShell,
    windowsHide: options.windowsHide ?? process.platform === 'win32',
  });
}

export function spawnDetached(command: string, args: string[], options: SpawnOptions = {}): ChildProcess {
  return spawnCommand(command, args, {
    ...options,
    detached: true,
    stdio: options.stdio ?? 'ignore',
  });
}

export function spawnShellCommand(command: string, options: SpawnOptions = {}): ChildProcess {
  const shell = resolveNativeShell();
  return spawn(shell.file, [...shell.args, command], {
    ...options,
    windowsHide: options.windowsHide ?? process.platform === 'win32',
  });
}

export async function execCommand(
  command: string,
  args: string[],
  options: ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const file = resolveExecutableCommand(command);
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
  const result = await execFileAsync(file, args, {
    ...options,
    encoding: 'utf8',
    shell: options.shell ?? needsShell,
    windowsHide: options.windowsHide ?? process.platform === 'win32',
  });
  return {
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

export function isPidAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      return true;
    }
    return false;
  }
}

export function getProcessCommandLine(
  pid: number | undefined,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }

  if (platform === 'win32') {
    const script = [
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue`,
      'if ($p) { [Console]::Out.Write($p.CommandLine) }',
    ].join('; ');
    const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    const commandLine = String(result.stdout ?? '').trim();
    return result.status === 0 && commandLine ? commandLine : undefined;
  }

  if (platform === 'linux') {
    try {
      const commandLine = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
      if (commandLine) {
        return commandLine;
      }
    } catch {
      // Fall back to ps below for non-procfs environments.
    }
  }

  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf8',
    timeout: 5000,
  });
  const commandLine = String(result.stdout ?? '').trim();
  return result.status === 0 && commandLine ? commandLine : undefined;
}

export async function killProcessTree(pid: number | undefined, options: { force?: boolean } = {}): Promise<boolean> {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  if (process.platform === 'win32') {
    const args = ['/PID', String(pid), '/T'];
    if (options.force) {
      args.push('/F');
    }
    try {
      await execFileAsync('taskkill.exe', args, {
        windowsHide: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  try {
    process.kill(pid, options.force ? 'SIGKILL' : 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

export async function isCommandAvailable(command: string): Promise<boolean> {
  const probe = process.platform === 'win32'
    ? { file: 'where.exe', args: [command] }
    : { file: 'command', args: ['-v', command] };

  try {
    if (process.platform === 'win32') {
      await execFileAsync(probe.file, probe.args, { timeout: 5000, windowsHide: true });
    } else {
      await execFileAsync('sh', ['-c', `command -v ${JSON.stringify(command)}`], { timeout: 5000 });
    }
    return true;
  } catch {
    return false;
  }
}
