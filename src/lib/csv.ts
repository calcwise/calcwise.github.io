/*
 * Экспорт графика в CSV: разделитель «;», десятичная запятая, BOM — так файл
 * открывается в Excel и Numbers на русской локали без диалога импорта.
 */
import type { ScheduleResult } from './mortgage/index.ts';

const COLUMNS: Array<{
  title: string;
  key: keyof ScheduleResult['rows'][number];
  money?: boolean;
}> = [
  { title: '№', key: 'month' },
  { title: 'Ставка, %', key: 'ratePercent' },
  { title: 'Платёж', key: 'payment', money: true },
  { title: 'Основной долг', key: 'principal', money: true },
  { title: 'Проценты', key: 'interest', money: true },
  { title: 'Досрочно', key: 'prepayment', money: true },
  { title: 'Всего за месяц', key: 'total', money: true },
  { title: 'Остаток долга', key: 'balance', money: true },
  { title: 'Выплачено всего', key: 'paidTotal', money: true },
  { title: 'Выплачено долга', key: 'paidPrincipal', money: true },
  { title: 'Выплачено процентов', key: 'paidInterest', money: true },
  { title: 'Осталось выплатить', key: 'remainingTotal', money: true },
  { title: 'Отсрочка', key: 'isGrace' },
];

const cell = (value: number | boolean | string, money?: boolean): string => {
  if (typeof value === 'boolean') return value ? 'да' : '';
  if (typeof value === 'number')
    return (money ? value.toFixed(2) : String(value)).replace('.', ',');
  return String(value);
};

export function scheduleToCsv(result: ScheduleResult): string {
  const header = COLUMNS.map((c) => c.title).join(';');
  const body = result.rows.map((row) => COLUMNS.map((c) => cell(row[c.key], c.money)).join(';'));
  return `﻿${[header, ...body].join('\n')}\n`;
}

export function downloadText(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
