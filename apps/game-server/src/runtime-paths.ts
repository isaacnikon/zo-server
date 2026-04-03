import fs from 'node:fs';
import path from 'node:path';

function findRepoRoot(startDir: string): string {
  let currentDir = startDir;

  while (true) {
    if (fs.existsSync(path.join(currentDir, 'compose.yaml'))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Unable to resolve repository root from ${startDir}`);
    }

    currentDir = parentDir;
  }
}

export function resolveRepoPath(...segments: string[]): string {
  return path.resolve(findRepoRoot(import.meta.dirname), ...segments);
}
