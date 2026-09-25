import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSchedule } from './schedule.ts';
import { parseAmount } from './money.ts';
import { ScheduleInputError, plannedMonths } from './validate.ts';
import type { ScheduleInput } from './types.ts';

const base: ScheduleInput = {
  amount: 100_000,
  months: 12,
  type: 'annuity',
  rates: [{ fromMonth: 1, ratePercent: 12 }],
};

/* Каждая ошибка — с полем формы и понятным текстом, а не NaN в графике */
const cases: Array<[string, Partial<ScheduleInput> | Record<string, unknown>, string, RegExp]> = [
  ['сумма 0', { amount: 0 }, 'amount', /больше 0/],
  ['сумма текстом', { amount: 'abc' }, 'amount', /больше 0/],
  ['срок 0', { months: 0 }, 'months', /от 1/],
  ['срок дробный', { months: 1.5 }, 'months', /целым/],
  ['срок больше 600', { months: 601 }, 'months', /600/],
  ['тип неизвестен', { type: 'bullet' }, 'type', /Неизвестный тип/],
  ['нет ставок', { rates: [] }, 'rates', /хотя бы одна/],
  ['первая ставка не с 1-го', { rates: [{ fromMonth: 2, ratePercent: 12 }] }, 'rates', /с 1-го/],
  [
    'ставка отрицательная',
    { rates: [{ fromMonth: 1, ratePercent: -1 }] },
    'rates.0',
    /отрицательной/,
  ],
  [
    'месяц ставки дробный',
    {
      rates: [
        { fromMonth: 1, ratePercent: 12 },
        { fromMonth: 2.5, ratePercent: 10 },
      ],
    },
    'rates.1',
    /целым/,
  ],
  [
    'две ставки с одного месяца',
    {
      rates: [
        { fromMonth: 1, ratePercent: 12 },
        { fromMonth: 1, ratePercent: 10 },
      ],
    },
    'rates.1',
    /Две ставки/,
  ],
  ['отсрочка с 0-го', { gracePeriods: [{ start: 0, months: 2 }] }, 'grace.0', /от 1/],
  ['отсрочка 0 месяцев', { gracePeriods: [{ start: 1, months: 0 }] }, 'grace.0', /от 1/],
  ['отсрочка до конца срока', { gracePeriods: [{ start: 1, months: 12 }] }, 'grace.0', /не позже/],
  [
    'отсрочки пересекаются',
    {
      gracePeriods: [
        { start: 1, months: 3 },
        { start: 3, months: 2 },
      ],
    },
    'grace.1',
    /пересекаются/,
  ],
  [
    'досрочка в 0-м месяце',
    { prepayments: [{ month: 0, amount: 1, mode: 'term', repeat: 'once' }] },
    'prepayments.0',
    /от 1/,
  ],
  [
    'досрочка 0',
    { prepayments: [{ month: 1, amount: 0, mode: 'term', repeat: 'once' }] },
    'prepayments.0',
    /больше 0/,
  ],
  [
    'повторы кончаются раньше начала',
    { prepayments: [{ month: 5, amount: 1, mode: 'term', repeat: 'monthly', untilMonth: 3 }] },
    'prepayments.0',
    /не раньше/,
  ],
  [
    'неизвестный вид досрочки',
    { prepayments: [{ month: 1, amount: 1, mode: 'term', repeat: 'once', kind: 'gift' }] },
    'prepayments.0',
    /Неизвестный вид/,
  ],
];

for (const [name, patch, field, message] of cases) {
  test(`валидация: ${name}`, () => {
    assert.throws(
      () => buildSchedule({ ...base, ...patch } as ScheduleInput),
      (e: unknown) =>
        e instanceof ScheduleInputError && e.field === field && message.test(e.message),
    );
  });
}

test('валидация: сумма строкой с запятой принимается', () => {
  assert.equal(buildSchedule({ ...base, amount: '100000,50' }).summary.amount, 100000.5);
});

test('plannedMonths: отсрочка продлевает срок только по флагу', () => {
  const grace = [{ start: 1, months: 6 }];
  assert.equal(plannedMonths({ ...base, gracePeriods: grace }), 12);
  assert.equal(plannedMonths({ ...base, gracePeriods: grace, graceExtendsTerm: true }), 18);
});

test('parseAmount: пробелы, неразрывные пробелы и запятая', () => {
  assert.equal(parseAmount('3 000 000,50'), 3000000.5);
  assert.equal(parseAmount('3 000'), 3000);
  assert.equal(parseAmount(42), 42);
  assert.ok(Number.isNaN(parseAmount('12a')));
});
