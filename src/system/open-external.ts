import { spawnDetached } from './process.js';

export async function openExternalUrl(url: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  const command = resolveOpenCommand(platform, url);
  await new Promise<void>((resolve, reject) => {
    const child = spawnDetached(command.file, command.args, {
      stdio: 'ignore',
    });

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function resolveOpenCommand(platform: NodeJS.Platform, url: string): { file: string; args: string[] } {
  if (platform === 'darwin') {
    return { file: 'open', args: [url] };
  }

  if (platform === 'win32') {
    return { file: 'powershell', args: ['-NoProfile', '-Command', 'Start-Process', url] };
  }

  return { file: 'xdg-open', args: [url] };
}
