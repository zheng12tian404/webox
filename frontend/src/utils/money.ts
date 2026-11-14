/** Integer-cent money helpers. Never use floating point for arithmetic. */
export const formatMoney = (cents: number): string => {
  const n = Math.trunc(cents);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}¥${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

/** Parse a yuan string (e.g. "15.5") into integer cents without float math. */
export const parseYuanToCents = (input: string): number | null => {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const yuan = Number(m[1]);
  const frac = (m[2] ?? '').padEnd(2, '0');
  return yuan * 100 + Number(frac);
};

export const centsToYuanInput = (cents: number | null | undefined): string => {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '';
  const n = Math.trunc(cents);
  return `${Math.floor(n / 100)}.${String(Math.abs(n % 100)).padStart(2, '0')}`;
};
