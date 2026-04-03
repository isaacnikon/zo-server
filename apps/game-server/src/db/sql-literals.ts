function dollarTag(text: string): string {
  let index = 0;
  while (text.includes(`$json${index}$`)) {
    index += 1;
  }
  return `$json${index}$`;
}

export function sqlText(value: unknown): string {
  if (value == null) {
    return 'NULL';
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function sqlInteger(value: unknown, fallback = 0): string {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return String(fallback | 0);
  }
  return String(Math.trunc(normalized));
}

export function sqlBigInt(value: unknown, fallback = 0): string {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return String(Math.trunc(fallback));
  }
  return String(Math.trunc(normalized));
}

export function sqlNullableInteger(value: unknown): string {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return 'NULL';
  }
  return String(Math.trunc(normalized));
}

export function sqlBoolean(value: unknown): string {
  return value === true ? 'TRUE' : 'FALSE';
}

export function sqlJson(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  const tag = dollarTag(json);
  return `${tag}${json}${tag}::jsonb`;
}

export function sqlTimestamp(value: unknown, fallbackIso = new Date().toISOString()): string {
  const iso = typeof value === 'string' && value.length > 0 ? value : fallbackIso;
  return `${sqlText(iso)}::timestamptz`;
}
