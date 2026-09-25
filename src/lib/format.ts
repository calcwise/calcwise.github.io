/*
 * Форматирование чисел для интерфейса. Валюты нет: суммы показываются как числа
 * с разделителями разрядов, потому что расчёт не зависит от валюты.
 */

const money = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const integer = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export const fmtMoney = (n: number): string => money.format(n);
export const fmtInt = (n: number): string => integer.format(n);

/** «1 234 567,89» → «1 234 568» для осей графиков и коротких подписей */
export function fmtShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${compact.format(n / 1_000_000)} млн`;
  if (abs >= 10_000) return `${compact.format(n / 1_000)} тыс.`;
  return integer.format(n);
}

/** Ставка без лишних нулей: 15.4 → «15,4», 12 → «12» */
export function fmtRate(rate: number): string {
  return String(Math.round(rate * 10_000) / 10_000).replace('.', ',');
}

/** Число из поля ввода: пробелы и запятая допустимы. NaN, если это не число */
export function parseNumber(raw: string): number {
  const normalized = raw.replace(/[\s ]/g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}

/** Целое из поля ввода. NaN, если не целое */
export function parseInteger(raw: string): number {
  const normalized = raw.replace(/[\s ]/g, '');
  return /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
}

/** Сумма в поле ввода с разделителями: «3000000.5» → «3 000 000,5» */
export function formatAmountInput(raw: string): string {
  const n = parseNumber(raw);
  if (!Number.isFinite(n)) return raw;
  const [int = '0', frac] = raw.replace(/[\s ]/g, '').replace(',', '.').split('.');
  const head = integer.format(Number(int));
  return frac !== undefined && frac !== '' ? `${head},${frac.slice(0, 2)}` : head;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** 239 → «19 лет 11 месяцев» */
export function fmtMonthsAsYears(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts: string[] = [];
  if (y) parts.push(`${y} ${plural(y, 'год', 'года', 'лет')}`);
  if (m) parts.push(`${m} ${plural(m, 'месяц', 'месяца', 'месяцев')}`);
  return parts.join(' ') || '0 месяцев';
}

export function fmtMonths(months: number): string {
  return `${months} ${plural(months, 'месяц', 'месяца', 'месяцев')}`;
}
