import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { LocalShellBackend, type FileInfo } from 'deepagents';

export class SafeLocalShellBackend extends LocalShellBackend {
  override async globInfo(pattern: string, searchPath = '/'): Promise<FileInfo[]> {
    if (pattern.startsWith('/')) {
      pattern = pattern.slice(1);
    }

    const resolvedSearchPath = searchPath === '/' || searchPath === ''
      ? this.cwd
      : this.virtualMode
        ? path.resolve(this.cwd, searchPath.replace(/^\//, ''))
        : path.resolve(this.cwd, searchPath);

    try {
      if (!(await fs.stat(resolvedSearchPath)).isDirectory()) {
        return [];
      }
    } catch {
      return [];
    }

    const baseOptions = {
      cwd: resolvedSearchPath,
      absolute: false as const,
      dot: true,
      followSymbolicLinks: false,
      suppressErrors: true,
    };

    const [fileMatches, directoryMatches] = await Promise.all([
      fg(pattern, { ...baseOptions, onlyFiles: true }),
      fg(pattern, { ...baseOptions, onlyDirectories: true }),
    ]);

    const toPath = (match: string) => (this.virtualMode ? `/${match}` : match);

    const toFileInfo = async (match: string, isDirectory: boolean): Promise<FileInfo | null> => {
      const fullPath = path.join(resolvedSearchPath, match);
      try {
        const stats = await fs.lstat(fullPath);
        if (isDirectory ? !stats.isDirectory() : !stats.isFile()) {
          return null;
        }
        return {
          path: toPath(match),
          is_dir: isDirectory,
          size: isDirectory ? 0 : stats.size,
          modified_at: stats.mtime.toISOString(),
        };
      } catch {
        return null;
      }
    };

    const [files, directories] = await Promise.all([
      Promise.all(fileMatches.map((match) => toFileInfo(match, false))),
      Promise.all(directoryMatches.map((match) => toFileInfo(match, true))),
    ]);

    return [...files, ...directories]
      .filter((entry): entry is FileInfo => entry !== null)
      .sort((left, right) => left.path.localeCompare(right.path));
  }
}