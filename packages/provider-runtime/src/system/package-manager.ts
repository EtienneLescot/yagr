import { resolveExecutableCommand } from './process.js';

export function resolvePackageManagerCommand(command: 'npm' | 'npx', platform: NodeJS.Platform = process.platform): string {
  return resolveExecutableCommand(command, platform);
}

export function resolvePackageManagerSpawnOptions(platform: NodeJS.Platform = process.platform): {
  shell?: boolean;
  windowsHide?: boolean;
} {
  if (platform === 'win32') {
    return {
      shell: true,
      windowsHide: true,
    };
  }

  return {};
}
