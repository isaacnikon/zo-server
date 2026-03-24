import path from 'node:path';

function getProjectRootFrom(dirname: string): string {
  const parent = path.resolve(dirname, '..');
  return path.basename(parent) === 'dist' ? path.resolve(parent, '..') : parent;
}

export function resolveRepoPath(...segments: string[]): string {
  return path.resolve(getProjectRootFrom(import.meta.dirname), ...segments);
}
