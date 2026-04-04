const adminDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'UTC',
});

const adminNumberFormatter = new Intl.NumberFormat('en-US');

export function formatAdminDate(value: Date | number | string | null | undefined): string {
  if (!value) {
    return 'n/a';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return `${adminDateFormatter.format(date)} UTC`;
}

export function formatAdminNumber(value: number | string | null | undefined): string {
  if (value == null || value === '') {
    return '0';
  }

  const number = Number(value);
  if (Number.isFinite(number)) {
    return adminNumberFormatter.format(number);
  }

  return String(value);
}
