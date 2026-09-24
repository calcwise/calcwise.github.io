/*
 * Даты последнего изменения страниц для карты сайта из истории git:
 * mtime после клонирования у всех файлов одинаковый, а одинаковый lastmod
 * поисковики игнорируют. Без git — mtime, в крайнем случае дата сборки.
 * Выполняется только при сборке.
 */
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

function gitDates(): Map<string, string> {
  const dates = new Map<string, string>();
  try {
    const log = execFileSync(
      'git',
      ['log', '--date=iso-strict', '--pretty=format:%cd', '--name-only', '--', 'src'],
      {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    let current = '';
    for (const line of log.split('\n')) {
      if (line === '') continue;
      if (/^\d{4}-\d{2}-\d{2}T/.test(line)) current = line;
      else if (current && !dates.has(line)) dates.set(line, current);
    }
  } catch {
    /* не репозиторий или git недоступен */
  }
  return dates;
}

const DATES = gitDates();
const day = (iso: string): string => iso.slice(0, 10);

export function lastModified(files: string[]): string {
  const stamps = files.map((file) => {
    const committed = DATES.get(file);
    if (committed) return day(committed);
    try {
      return day(statSync(file).mtime.toISOString());
    } catch {
      return '';
    }
  });
  const known = stamps.filter(Boolean).sort();
  return known.at(-1) ?? day(new Date().toISOString());
}
