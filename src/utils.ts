export type UnknownRecord = Record<string, any>;

export function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function sanitizeQuestDialogueText(value: unknown, maxLength = 220): string {
  if (typeof value !== 'string') {
    return '';
  }

  const sanitized = value
    .replace(/<\d+><\d+>/g, ' ')
    .replace(/\u00a1{3,}/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (sanitized.length <= maxLength) {
    return sanitized;
  }

  return `${sanitized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
