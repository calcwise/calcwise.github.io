import { test } from 'node:test';
import assert from 'node:assert/strict';
import Big from 'big.js';

import { buildSchedule } from './schedule.ts';
import {
  extraPaymentForTerm,
  prepaymentEffect,
  rateSensitivity,
  termSensitivity,
  yearSummaries,
} from './analysis.ts';
import { ScheduleInputError } from './validate.ts';
import type { ScheduleInput, ScheduleType } from './types.ts';

Big.DP = 40;
const round2 = (b: Big) => Number(b.round(2, Big.roundHalfUp).toFixed(2));
/* Эталон считает без подрезки знаков, движок — с 12 знаками: на границе полукопейки
   (например, ровно 37 984,375) округление может разойтись на копейку в любую сторону */
const near = (actual: number, expected: Big, message: string) =>
  assert.ok(
    Math.abs(actual - round2(expected)) <= 0.011,
    `${message}: ${actual} vs ${round2(expected)}`,
  );
const fixed = (
  amount: number,
  ratePercent: number,
  months: number,
  type: ScheduleType,
  extra: Partial<ScheduleInput> = {},
): ScheduleInput => ({
  amount,
  months,
  type,
  rates: [{ fromMonth: 1, ratePercent }],
  ...extra,
});

/**
 * Независимый эталон для фиксированной ставки, одной отсрочки и без досрочек:
 * пересчёт с полной точностью и сравнение каждой строки.
 */
function assertMatchesReference(input: ScheduleInput) {
  const result = buildSchedule(input);
  const S = new Big(input.amount);
  const r = new Big(input.rates[0]!.ratePercent).div(100).div(12);
  const grace = input.gracePeriods?.[0];
  const graceMonths = grace?.months ?? 0;
  const total = input.graceExtendsTerm ? input.months + graceMonths : input.months;
  const paying = total - graceMonths;
  const isGrace = (m: number) =>
    Boolean(grace && m >= grace.start && m < grace.start + grace.months);

  let fixedPayment: Big | null = null;
  let fixedPrincipal: Big | null = null;
  if (input.type === 'annuity') {
    if (r.eq(0)) fixedPayment = S.div(paying);
    else {
      const f = r.plus(1).pow(paying);
      fixedPayment = S.times(r).times(f).div(f.minus(1));
    }
  } else fixedPrincipal = S.div(paying);

  assert.equal(result.rows.length, total, 'число строк');
  let balance = S;
  let paidTotal = new Big(0);
  let paidInterest = new Big(0);
  for (let m = 1; m <= total; m++) {
    const interest = balance.times(r);
    let principal: Big;
    if (isGrace(m)) principal = new Big(0);
    else if (m === total) principal = balance;
    else principal = fixedPayment ? fixedPayment.minus(interest) : fixedPrincipal!;
    const payment = principal.plus(interest);
    balance = balance.minus(principal);
    paidTotal = paidTotal.plus(payment);
    paidInterest = paidInterest.plus(interest);
    const row = result.rows[m - 1]!;
    assert.equal(row.month, m);
    assert.equal(row.isGrace, isGrace(m), `месяц ${m}: отсрочка`);
    near(row.payment, payment, `месяц ${m}: платёж`);
    near(row.principal, principal, `месяц ${m}: долг`);
    near(row.interest, interest, `месяц ${m}: проценты`);
    near(row.balance, balance, `месяц ${m}: остаток`);
    near(row.paidTotal, paidTotal, `месяц ${m}: выплачено`);
    near(row.paidInterest, paidInterest, `месяц ${m}: выплачено процентов`);
  }
  assert.equal(result.rows.at(-1)!.balance, 0);
  assert.equal(result.rows.at(-1)!.remainingTotal, 0);
  near(result.summary.totalPaid, paidTotal, 'всего выплачено');
  near(result.summary.totalInterest, paidInterest, 'переплата');
  assert.equal(result.summary.totalPrincipal, round2(S));
  assert.equal(result.summary.plannedMonths, total);
  assert.equal(result.summary.actualMonths, total);
  assert.equal(result.summary.payingMonths, paying);
  assert.equal(result.summary.graceMonths, graceMonths);
}

const CASES: Array<[number, number, number, Partial<ScheduleInput>?]> = [
  [100_000, 12, 12],
  [3_000_000, 12, 240],
  [5_500_000, 8.5, 360],
  [1_234_567.89, 6.1, 84],
  [1_000_000, 0, 12],
  [999.99, 25, 1],
  [10_000, 15.75, 7],
  [3_000_000, 12, 240, { gracePeriods: [{ start: 1, months: 6 }] }],
  [3_000_000, 12, 240, { gracePeriods: [{ start: 13, months: 12 }] }],
  [100_000, 12, 12, { gracePeriods: [{ start: 1, months: 11 }] }],
  [250_000, 15.4, 240, { gracePeriods: [{ start: 1, months: 6 }], graceExtendsTerm: true }],
  [250_000, 15.4, 240, { gracePeriods: [{ start: 240, months: 3 }], graceExtendsTerm: true }],
];

for (const type of ['annuity', 'diff'] as ScheduleType[]) {
  for (const [amount, rate, months, extra] of CASES) {
    test(`${type}: эталон ${amount} / ${rate}% / ${months} мес.${extra ? ' ' + JSON.stringify(extra) : ''}`, () => {
      assertMatchesReference(fixed(amount, rate, months, type, extra));
    });
  }
}

test('аннуитет: учебный эталон 100 000 под 12% на 12 мес.', () => {
  const r = buildSchedule(fixed(100_000, 12, 12, 'annuity'));
  assert.equal(r.summary.regularPayment, 8884.88);
  assert.equal(r.rows[0]!.interest, 1000);
  assert.equal(r.rows[0]!.principal, 7884.88);
  assert.equal(r.rows[0]!.balance, 92115.12);
  assert.equal(r.summary.totalInterest, 6618.55);
  assert.equal(r.summary.lastPayment, 8884.88);
});

test('аннуитет: платёж одинаковый все 240 месяцев', () => {
  const r = buildSchedule(fixed(3_000_000, 12, 240, 'annuity'));
  assert.ok(r.rows.every((row) => row.payment === 33032.58));
  assert.equal(r.summary.totalInterest, 4927820.16);
});

test('дифференцированный: эталон 100 000 под 12% на 12 мес.', () => {
  const r = buildSchedule(fixed(100_000, 12, 12, 'diff'));
  assert.equal(r.rows[0]!.payment, 9333.33);
  assert.equal(r.rows[1]!.interest, 916.67);
  assert.equal(r.rows[11]!.principal, 8333.33);
  assert.equal(r.summary.lastPayment, 8416.67);
  assert.equal(r.summary.totalInterest, 6500);
});

test('банковский расчётник: 250 000, 15,4%, 239 мес., отсрочка 12 → переплата 559 439,55', () => {
  const r = buildSchedule(
    fixed(250_000, 15.4, 239, 'annuity', { gracePeriods: [{ start: 1, months: 12 }] }),
  );
  assert.equal(r.rows.length, 239);
  assert.equal(r.rows[0]!.payment, 3208.33);
  assert.equal(r.rows[12]!.payment, 3396.21);
  assert.equal(r.summary.graceInterest, 38500);
  assert.equal(r.summary.totalInterest, 559439.55);
  assert.equal(r.summary.totalPaid, 809439.55);
});

test('отсрочка в середине: платёж до и после одинаковый', () => {
  const r = buildSchedule(
    fixed(3_000_000, 12, 240, 'annuity', { gracePeriods: [{ start: 13, months: 12 }] }),
  );
  assert.equal(r.rows[0]!.payment, r.rows[24]!.payment);
  for (let m = 12; m < 24; m++) assert.equal(r.rows[m]!.balance, r.rows[11]!.balance);
});

test('две отсрочки в одном графике', () => {
  const r = buildSchedule(
    fixed(1_000_000, 10, 120, 'annuity', {
      gracePeriods: [
        { start: 1, months: 6 },
        { start: 61, months: 3 },
      ],
    }),
  );
  assert.equal(r.summary.graceMonths, 9);
  assert.equal(r.summary.payingMonths, 111);
  assert.equal(r.rows.length, 120);
  assert.equal(r.rows.at(-1)!.balance, 0);
  /* Остаток в отсрочку не меняется */
  assert.equal(r.rows[60]!.balance, r.rows[59]!.balance);
  assert.equal(r.rows[62]!.balance, r.rows[59]!.balance);
});

test('ставка по периодам: льготные 12 месяцев, затем рыночная', () => {
  const r = buildSchedule({
    amount: 300_000,
    months: 240,
    type: 'annuity',
    rates: [
      { fromMonth: 1, ratePercent: 5 },
      { fromMonth: 13, ratePercent: 15 },
    ],
  });
  assert.equal(r.rows[0]!.ratePercent, 5);
  assert.equal(r.rows[12]!.ratePercent, 15);
  /* Первый год — аннуитет на 240 мес. под 5% */
  assert.equal(
    r.rows[0]!.payment,
    buildSchedule(fixed(300_000, 5, 240, 'annuity')).summary.regularPayment,
  );
  /* С 13-го месяца — аннуитет на остаток и 228 мес. под 15% */
  const rest = buildSchedule(fixed(r.rows[11]!.balance, 15, 228, 'annuity'));
  assert.equal(r.rows[12]!.payment, rest.summary.regularPayment);
  assert.ok(r.rows[12]!.payment > r.rows[11]!.payment);
  assert.equal(r.rows.length, 240);
  assert.equal(r.rows.at(-1)!.balance, 0);
  /* Общая логика: переплата между чистыми 5% и чистыми 15% */
  const low = buildSchedule(fixed(300_000, 5, 240, 'annuity')).summary.totalInterest;
  const high = buildSchedule(fixed(300_000, 15, 240, 'annuity')).summary.totalInterest;
  assert.ok(r.summary.totalInterest > low && r.summary.totalInterest < high);
});

test('ставка по периодам: дифференцированный, часть долга не меняется', () => {
  const r = buildSchedule({
    amount: 120_000,
    months: 12,
    type: 'diff',
    rates: [
      { fromMonth: 1, ratePercent: 12 },
      { fromMonth: 7, ratePercent: 24 },
    ],
  });
  assert.ok(r.rows.every((row) => row.principal === 10_000));
  assert.equal(r.rows[6]!.interest, 1200); // 60 000 * 2%
  assert.equal(r.rows[5]!.interest, 700); // 70 000 * 1%
});

test('досрочка «уменьшить срок»: платёж прежний, кредит короче, проценты меньше', () => {
  const base = buildSchedule(fixed(3_000_000, 12, 240, 'annuity'));
  const r = buildSchedule(
    fixed(3_000_000, 12, 240, 'annuity', {
      prepayments: [{ month: 12, amount: 500_000, mode: 'term', repeat: 'once' }],
    }),
  );
  assert.equal(r.rows[11]!.prepayment, 500_000);
  assert.equal(r.rows[11]!.total, 500_000 + 33032.58);
  assert.equal(r.rows[12]!.payment, 33032.58, 'платёж после досрочки не изменился');
  assert.ok(r.summary.actualMonths < 240);
  assert.equal(r.rows.at(-1)!.balance, 0);
  assert.ok(r.rows.at(-1)!.payment <= 33032.58, 'последний платёж не больше обычного');
  assert.ok(r.summary.totalInterest < base.summary.totalInterest);
  assert.equal(r.summary.totalPrincipal, 3_000_000);
  assert.equal(r.summary.totalPrepaid, 500_000);
  const effect = prepaymentEffect(r)!;
  assert.equal(effect.monthsSaved, 240 - r.summary.actualMonths);
  assert.ok(effect.interestSaved > 0);
  assert.equal(
    Math.round((effect.baseline.summary.totalInterest - effect.interestSaved) * 100) / 100,
    r.summary.totalInterest,
  );
});

test('досрочка «уменьшить платёж»: срок прежний, платёж ниже', () => {
  const r = buildSchedule(
    fixed(3_000_000, 12, 240, 'annuity', {
      prepayments: [{ month: 12, amount: 500_000, mode: 'payment', repeat: 'once' }],
    }),
  );
  assert.equal(r.summary.actualMonths, 240);
  assert.ok(r.rows[12]!.payment < r.rows[11]!.payment);
  /* Новый платёж — аннуитет на остаток и 228 месяцев */
  const expected = buildSchedule(fixed(r.rows[11]!.balance, 12, 228, 'annuity')).summary
    .regularPayment;
  assert.equal(r.rows[12]!.payment, expected);
  assert.equal(r.rows.at(-1)!.balance, 0);
  assert.ok(prepaymentEffect(r)!.paymentReduced > 0);
});

test('регулярная досрочка каждый месяц и каждый год', () => {
  const monthly = buildSchedule(
    fixed(1_000_000, 10, 120, 'annuity', {
      prepayments: [{ month: 1, amount: 5_000, mode: 'term', repeat: 'monthly' }],
    }),
  );
  assert.ok(monthly.rows.slice(0, -1).every((row) => row.prepayment === 5_000));
  assert.ok(monthly.summary.actualMonths < 120);

  const yearly = buildSchedule(
    fixed(1_000_000, 10, 120, 'annuity', {
      prepayments: [{ month: 12, amount: 50_000, mode: 'term', repeat: 'yearly', untilMonth: 60 }],
    }),
  );
  const months = yearly.rows.filter((row) => row.prepayment > 0).map((row) => row.month);
  assert.deepEqual(months, [12, 24, 36, 48, 60]);
});

test('досрочка больше остатка закрывает кредит без переплаты', () => {
  const r = buildSchedule(
    fixed(100_000, 12, 12, 'annuity', {
      prepayments: [{ month: 6, amount: 1_000_000, mode: 'term', repeat: 'once' }],
    }),
  );
  assert.equal(r.summary.actualMonths, 6);
  assert.equal(r.rows.at(-1)!.balance, 0);
  assert.equal(r.summary.totalPrincipal, 100_000);
  assert.ok(Math.abs(r.rows[5]!.prepayment - (r.rows[4]!.balance - r.rows[5]!.principal)) <= 0.01);
});

test('досрочка в отсрочку идёт в долг, платёж после отсрочки пересчитан', () => {
  const r = buildSchedule(
    fixed(1_000_000, 12, 120, 'annuity', {
      gracePeriods: [{ start: 1, months: 6 }],
      prepayments: [{ month: 3, amount: 100_000, mode: 'payment', repeat: 'once' }],
    }),
  );
  assert.equal(r.rows[2]!.prepayment, 100_000);
  assert.equal(r.rows[2]!.balance, 900_000);
  assert.equal(r.rows[3]!.interest, 9_000);
  assert.equal(
    r.rows[6]!.payment,
    buildSchedule(fixed(900_000, 12, 114, 'annuity')).summary.regularPayment,
  );
});

test('досрочка «в срок» и смена ставки: срок берётся из платежа, а не из плана', () => {
  const r = buildSchedule({
    amount: 1_000_000,
    months: 120,
    type: 'annuity',
    rates: [
      { fromMonth: 1, ratePercent: 10 },
      { fromMonth: 25, ratePercent: 14 },
    ],
    prepayments: [{ month: 6, amount: 300_000, mode: 'term', repeat: 'once' }],
  });
  const withoutPrepay = buildSchedule({
    amount: 1_000_000,
    months: 120,
    type: 'annuity',
    rates: [
      { fromMonth: 1, ratePercent: 10 },
      { fromMonth: 25, ratePercent: 14 },
    ],
  });
  assert.ok(r.summary.actualMonths < withoutPrepay.summary.actualMonths);
  assert.ok(r.rows[24]!.payment > r.rows[23]!.payment, 'после роста ставки платёж вырос');
  assert.ok(
    r.rows[24]!.payment < withoutPrepay.rows[24]!.payment * 1.5,
    'но не пересчитан на длинный план',
  );
  assert.equal(r.rows.at(-1)!.balance, 0);
});

test('сводка по годам сходится с итогами', () => {
  const r = buildSchedule(
    fixed(3_000_000, 12, 240, 'annuity', {
      prepayments: [{ month: 24, amount: 200_000, mode: 'term', repeat: 'once' }],
    }),
  );
  const years = yearSummaries(r);
  assert.equal(years.length, Math.ceil(r.rows.length / 12));
  const interest = Math.round(years.reduce((a, y) => a + y.interest, 0) * 100) / 100;
  assert.ok(Math.abs(interest - r.summary.totalInterest) < 0.05);
  assert.equal(years.at(-1)!.balance, 0);
  assert.equal(years[1]!.prepayment, 200_000);
});

test('чувствительность к ставке и сроку', () => {
  const input = fixed(250_000, 15.4, 240, 'annuity');
  const rates = rateSensitivity(input);
  assert.equal(rates.length, 5);
  assert.ok(
    rates.find((c) => c.isCurrent)!.payment === buildSchedule(input).summary.regularPayment,
  );
  for (let i = 1; i < rates.length; i++) assert.ok(rates[i]!.payment > rates[i - 1]!.payment);
  const terms = termSensitivity(input);
  assert.ok(terms.some((c) => c.isCurrent));
  for (let i = 1; i < terms.length; i++) assert.ok(terms[i]!.payment < terms[i - 1]!.payment);
});

test('обратный расчёт: доплата для закрытия за 10 лет', () => {
  const input = fixed(3_000_000, 12, 240, 'annuity');
  const extra = extraPaymentForTerm(input, 120)!;
  assert.ok(extra > 0);
  const r = buildSchedule({
    ...input,
    prepayments: [{ month: 1, amount: extra, mode: 'term', repeat: 'monthly' }],
  });
  assert.ok(r.summary.actualMonths <= 120 && r.summary.actualMonths >= 118);
  assert.equal(extraPaymentForTerm(input, 240), null);
});

test('без отсрочки и досрочек результат не зависит от пустых списков', () => {
  const a = buildSchedule(fixed(3_000_000, 12, 240, 'annuity'));
  const b = buildSchedule(
    fixed(3_000_000, 12, 240, 'annuity', {
      gracePeriods: [],
      prepayments: [],
      graceExtendsTerm: true,
    }),
  );
  assert.deepEqual(a.rows, b.rows);
});

test('валидация', () => {
  const base = fixed(100_000, 12, 12, 'annuity');
  const throwsField = (input: ScheduleInput, field: string) => {
    assert.throws(
      () => buildSchedule(input),
      (e: unknown) => e instanceof ScheduleInputError && e.field === field,
      field,
    );
  };
  throwsField({ ...base, amount: 0 }, 'amount');
  throwsField({ ...base, amount: 'abc' }, 'amount');
  throwsField({ ...base, months: 0 }, 'months');
  throwsField({ ...base, months: 1.5 }, 'months');
  throwsField({ ...base, rates: [] }, 'rates');
  throwsField({ ...base, rates: [{ fromMonth: 2, ratePercent: 12 }] }, 'rates');
  throwsField({ ...base, rates: [{ fromMonth: 1, ratePercent: -1 }] }, 'rates.0');
  throwsField({ ...base, gracePeriods: [{ start: 1, months: 12 }] }, 'grace.0');
  throwsField({ ...base, gracePeriods: [{ start: 12, months: 1 }] }, 'grace.0');
  throwsField(
    {
      ...base,
      gracePeriods: [
        { start: 1, months: 3 },
        { start: 3, months: 2 },
      ],
    },
    'grace.1',
  );
  throwsField(
    { ...base, prepayments: [{ month: 0, amount: 1, mode: 'term', repeat: 'once' }] },
    'prepayments.0',
  );
  throwsField(
    { ...base, prepayments: [{ month: 1, amount: 0, mode: 'term', repeat: 'once' }] },
    'prepayments.0',
  );
  assert.doesNotThrow(() => buildSchedule({ ...base, gracePeriods: [{ start: 1, months: 11 }] }));
  assert.doesNotThrow(() =>
    buildSchedule({ ...base, gracePeriods: [{ start: 12, months: 1 }], graceExtendsTerm: true }),
  );
  assert.doesNotThrow(() => buildSchedule({ ...base, amount: '100000' }));
});

test('досрочка «в срок» внутри отсрочки: платёж после отсрочки прежний, срок короче', () => {
  const base = fixed(250_000, 15.4, 240, 'annuity', { gracePeriods: [{ start: 1, months: 12 }] });
  const plain = buildSchedule(base);
  const r = buildSchedule({
    ...base,
    prepayments: [{ month: 6, amount: 25_000, mode: 'term', repeat: 'once' }],
  });
  assert.equal(r.rows[5]!.prepayment, 25_000);
  assert.equal(r.rows[12]!.payment, plain.rows[12]!.payment, 'платёж после отсрочки не изменился');
  assert.ok(r.summary.actualMonths < 240, 'кредит закрыт раньше');
  assert.equal(r.rows.at(-1)!.balance, 0);
  assert.ok(r.summary.totalInterest < plain.summary.totalInterest);
  const effect = prepaymentEffect(r)!;
  assert.ok(effect.monthsSaved > 0);
});
