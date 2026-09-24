'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Big = require('big.js');

const { buildSchedule, SCHEDULE_TYPES } = require('./mortgage');

const sum = (values) => values.reduce((acc, v) => acc.plus(v), new Big(0));

const round2 = (b) => Number(b.round(2, Big.roundHalfUp).toFixed(2));

/**
 * Независимый эталонный пересчёт графика с полной точностью (как в банковских
 * расчётниках) и сравнение с результатом библиотеки по каждой строке.
 */
const assertMatchesReference = (result, { amount, ratePercent, months, type, graceStart = 1, graceMonths = 0, graceExtendsTerm = false }) => {
  Big.DP = 40;
  const S = new Big(amount);
  const r = new Big(ratePercent).div(100).div(12);
  const totalMonths = graceExtendsTerm ? months + graceMonths : months;
  const payingMonths = totalMonths - graceMonths;
  const graceEnd = graceStart + graceMonths - 1;

  let fixedPayment = null;
  let fixedPrincipal = null;
  if (type === 'annuity') {
    if (r.eq(0)) fixedPayment = S.div(payingMonths);
    else {
      const f = r.plus(1).pow(payingMonths);
      fixedPayment = S.times(r).times(f).div(f.minus(1));
    }
  } else {
    fixedPrincipal = S.div(payingMonths);
  }

  const rows = result.rows;
  assert.equal(rows.length, totalMonths, 'число строк');
  assert.equal(result.totalMonths, totalMonths);
  assert.equal(result.payingMonths, payingMonths);
  assert.equal(result.graceMonths, graceMonths);
  assert.equal(result.graceStart, graceMonths > 0 ? graceStart : null);

  let balance = S;
  let paidTotal = new Big(0);
  let paidPrincipal = new Big(0);
  let paidInterest = new Big(0);
  let graceInterest = new Big(0);
  const exactRows = [];

  for (let m = 1; m <= totalMonths; m++) {
    const isGrace = graceMonths > 0 && m >= graceStart && m <= graceEnd;
    const interest = balance.times(r);
    let principal;
    if (isGrace) principal = new Big(0);
    else if (m === totalMonths) principal = balance;
    else principal = fixedPayment ? fixedPayment.minus(interest) : fixedPrincipal;
    const payment = principal.plus(interest);
    balance = balance.minus(principal);
    paidTotal = paidTotal.plus(payment);
    paidPrincipal = paidPrincipal.plus(principal);
    paidInterest = paidInterest.plus(interest);
    if (isGrace) graceInterest = graceInterest.plus(interest);
    exactRows.push({ m, isGrace, payment, principal, interest, balance, paidTotal, paidPrincipal, paidInterest });
  }

  const totalPaid = paidTotal;
  exactRows.forEach((e, i) => {
    const row = rows[i];
    const tag = `месяц ${e.m}`;
    assert.equal(row.month, e.m, tag);
    assert.equal(row.isGrace, e.isGrace, `${tag}: отсрочка`);
    assert.equal(row.payment, round2(e.payment), `${tag}: платёж`);
    assert.equal(row.principal, round2(e.principal), `${tag}: основной долг`);
    assert.equal(row.interest, round2(e.interest), `${tag}: проценты`);
    assert.equal(row.balance, round2(e.balance), `${tag}: остаток`);
    assert.equal(row.paidTotal, round2(e.paidTotal), `${tag}: выплачено всего`);
    assert.equal(row.paidPrincipal, round2(e.paidPrincipal), `${tag}: выплачено долга`);
    assert.equal(row.paidInterest, round2(e.paidInterest), `${tag}: выплачено процентов`);
    assert.equal(row.remainingTotal, round2(totalPaid.minus(e.paidTotal)), `${tag}: осталось выплатить`);
    assert.ok(row.principal >= 0 && row.interest >= 0 && row.balance >= 0, `${tag}: нет отрицательных значений`);
  });

  assert.equal(rows[rows.length - 1].balance, 0, 'остаток после последнего платежа 0');
  assert.equal(rows[rows.length - 1].remainingTotal, 0);
  assert.equal(result.totalPrincipal, round2(paidPrincipal));
  assert.equal(result.totalPrincipal, round2(S), 'весь долг выплачен');
  assert.equal(result.totalPaid, round2(totalPaid));
  assert.equal(result.totalInterest, round2(paidInterest));
  assert.equal(result.graceInterest, round2(graceInterest));
  assert.equal(result.firstPayment, rows[0].payment);
  assert.equal(result.lastPayment, rows[rows.length - 1].payment);
  assert.equal(result.minPayment, Math.min(...rows.map((x) => x.payment)));
  assert.equal(result.maxPayment, Math.max(...rows.map((x) => x.payment)));
};

const CASES = [
  { amount: 100_000, ratePercent: 12, months: 12 },
  { amount: 3_000_000, ratePercent: 12, months: 240 },
  { amount: 5_500_000, ratePercent: 8.5, months: 360 },
  { amount: 1_234_567.89, ratePercent: 6.1, months: 84 },
  { amount: 1_000_000, ratePercent: 0, months: 12 },
  { amount: 999.99, ratePercent: 25, months: 1 },
  { amount: 10_000, ratePercent: 15.75, months: 7 },
  { amount: 3_000_000, ratePercent: 12, months: 240, graceStart: 1, graceMonths: 6 },
  { amount: 3_000_000, ratePercent: 12, months: 240, graceStart: 13, graceMonths: 12 },
  { amount: 1_234_567.89, ratePercent: 6.1, months: 84, graceStart: 83, graceMonths: 1 },
  { amount: 100_000, ratePercent: 12, months: 12, graceStart: 1, graceMonths: 11 },
  { amount: 250_000, ratePercent: 15.4, months: 240, graceStart: 1, graceMonths: 6, graceExtendsTerm: true },
  { amount: 250_000, ratePercent: 15.4, months: 240, graceStart: 240, graceMonths: 3, graceExtendsTerm: true },
];

for (const type of Object.values(SCHEDULE_TYPES)) {
  for (const params of CASES) {
    test(`${type}: совпадает с эталонным пересчётом для ${params.amount} / ${params.ratePercent}% / ${params.months} мес.${params.graceMonths ? ` (отсрочка ${params.graceMonths} с ${params.graceStart}${params.graceExtendsTerm ? ', продлевает срок' : ''})` : ''}`, () => {
      const result = buildSchedule({ ...params, type });
      assertMatchesReference(result, { ...params, type });
    });
  }
}

test('аннуитет: эталонный платёж 100 000 под 12% на 12 мес. = 8 884.88', () => {
  const r = buildSchedule({ amount: 100_000, ratePercent: 12, months: 12, type: 'annuity' });
  assert.equal(r.firstPayment, 8884.88);
  assert.equal(r.rows[0].interest, 1000);
  assert.equal(r.rows[0].principal, 7884.88);
  assert.equal(r.rows[0].balance, 92115.12);
  assert.equal(r.totalInterest, 6618.55); // 12 * 8 884.878868 - 100 000
  assert.equal(r.totalPaid, 106618.55);
  assert.equal(r.lastPayment, 8884.88);
});

test('аннуитет: платёж одинаковый во все месяцы, включая последний', () => {
  const r = buildSchedule({ amount: 3_000_000, ratePercent: 12, months: 240, type: 'annuity' });
  const payments = r.rows.map((x) => x.payment);
  assert.equal(payments[0], 33032.58);
  for (let i = 0; i < payments.length; i++) {
    assert.equal(payments[i], 33032.58, `месяц ${i + 1}`);
  }
  assert.equal(r.totalInterest, 4927820.16); // 240 * 33 032.584007 - 3 000 000
});

test('дифференцированный: эталон 100 000 под 12% на 12 мес.', () => {
  const r = buildSchedule({ amount: 100_000, ratePercent: 12, months: 12, type: 'diff' });
  assert.equal(r.rows[0].principal, 8333.33);
  assert.equal(r.rows[0].interest, 1000);
  assert.equal(r.rows[0].payment, 9333.33);
  assert.equal(r.rows[1].interest, 916.67); // 91 666.67 * 0.01
  assert.equal(r.rows[11].principal, 8333.33);
  assert.equal(r.lastPayment, 8416.67); // 8 333.33(3) + 83.33(3)
  assert.equal(r.totalInterest, 6500);
});

test('дифференцированный: платежи не возрастают', () => {
  const r = buildSchedule({ amount: 5_500_000, ratePercent: 8.5, months: 360, type: 'diff' });
  for (let i = 1; i < r.rows.length; i++) {
    assert.ok(r.rows[i].payment <= r.rows[i - 1].payment + 0.01, `месяц ${i + 1}`);
  }
  assert.ok(r.firstPayment > r.lastPayment);
});

test('переплата по дифференцированному графику меньше, чем по аннуитетному', () => {
  const params = { amount: 3_000_000, ratePercent: 12, months: 240 };
  const a = buildSchedule({ ...params, type: 'annuity' });
  const d = buildSchedule({ ...params, type: 'diff' });
  assert.ok(d.totalInterest < a.totalInterest);
  assert.equal(a.totalPrincipal, d.totalPrincipal);
});

test('нулевая ставка: платёж = сумма / срок, переплата 0', () => {
  const a = buildSchedule({ amount: 1_200_000, ratePercent: 0, months: 12, type: 'annuity' });
  const d = buildSchedule({ amount: 1_200_000, ratePercent: 0, months: 12, type: 'diff' });
  assert.equal(a.firstPayment, 100_000);
  assert.equal(a.totalInterest, 0);
  assert.equal(d.firstPayment, 100_000);
  assert.equal(d.totalInterest, 0);
});

test('строковые входные значения принимаются', () => {
  const r = buildSchedule({ amount: '100000', ratePercent: '12', months: 12 });
  assert.equal(r.firstPayment, 8884.88);
});

test('валидация входных данных', () => {
  assert.throws(() => buildSchedule({ amount: 0, ratePercent: 12, months: 12 }), RangeError);
  assert.throws(() => buildSchedule({ amount: -1, ratePercent: 12, months: 12 }), RangeError);
  assert.throws(() => buildSchedule({ amount: 100, ratePercent: -1, months: 12 }), RangeError);
  assert.throws(() => buildSchedule({ amount: 100, ratePercent: 12, months: 0 }), RangeError);
  assert.throws(() => buildSchedule({ amount: 100, ratePercent: 12, months: 1.5 }), RangeError);
  assert.throws(() => buildSchedule({ amount: 'abc', ratePercent: 12, months: 12 }), TypeError);
  assert.throws(() => buildSchedule({ amount: 100, ratePercent: 12, months: 12, type: 'x' }), RangeError);
});

test('отсрочка в начале: аннуитет равен аннуитету на оставшийся срок', () => {
  const withGrace = buildSchedule({ amount: 100_000, ratePercent: 12, months: 18, type: 'annuity', graceStart: 1, graceMonths: 6 });
  const plain = buildSchedule({ amount: 100_000, ratePercent: 12, months: 12, type: 'annuity' });
  for (let m = 0; m < 6; m++) {
    assert.equal(withGrace.rows[m].payment, 1000, `месяц ${m + 1}: только проценты 1%`);
    assert.equal(withGrace.rows[m].balance, 100_000);
  }
  assert.equal(withGrace.rows[6].payment, plain.rows[0].payment); // 8 884.88
  assert.equal(withGrace.lastPayment, plain.lastPayment);
  assert.equal(withGrace.graceInterest, 6000);
  assert.ok(new Big(withGrace.totalInterest).eq(new Big(plain.totalInterest).plus(6000)));
  assert.ok(new Big(withGrace.totalPaid).eq(new Big(plain.totalPaid).plus(6000)));
});

test('отсрочка в середине: до и после платёж одинаковый, долг в отсрочку не меняется', () => {
  const r = buildSchedule({ amount: 3_000_000, ratePercent: 12, months: 240, type: 'annuity', graceStart: 13, graceMonths: 12 });
  const payments = r.rows.map((x) => x.payment);
  assert.equal(payments[0], payments[24], 'платёж после отсрочки равен платежу до неё');
  for (let m = 12; m < 24; m++) {
    assert.ok(r.rows[m].isGrace);
    assert.equal(r.rows[m].balance, r.rows[11].balance);
    assert.equal(r.rows[m].payment, r.rows[12].payment, 'в отсрочку платёж постоянный');
  }
  assert.ok(!r.rows[11].isGrace && !r.rows[24].isGrace);
});

test('отсрочка: дифференцированный делит долг на платёжные месяцы', () => {
  const r = buildSchedule({ amount: 120_000, ratePercent: 12, months: 15, type: 'diff', graceStart: 1, graceMonths: 3 });
  assert.equal(r.rows[0].principal, 0);
  assert.equal(r.rows[0].payment, 1200);
  assert.equal(r.rows[3].principal, 10_000); // 120 000 / 12
  assert.equal(r.rows[3].payment, 11_200);
  assert.equal(r.graceInterest, 3600);
});

test('отсрочка: без отсрочки результат идентичен обычному расчёту', () => {
  const a = buildSchedule({ amount: 3_000_000, ratePercent: 12, months: 240, type: 'annuity' });
  const b = buildSchedule({ amount: 3_000_000, ratePercent: 12, months: 240, type: 'annuity', graceStart: 5, graceMonths: 0 });
  assert.deepEqual(a, b);
});

test('отсрочка: валидация', () => {
  const base = { amount: 100_000, ratePercent: 12, months: 12 };
  assert.throws(() => buildSchedule({ ...base, graceStart: 1, graceMonths: 12 }), RangeError);
  assert.throws(() => buildSchedule({ ...base, graceStart: 12, graceMonths: 1 }), RangeError);
  assert.throws(() => buildSchedule({ ...base, graceStart: 0, graceMonths: 1 }), RangeError);
  assert.throws(() => buildSchedule({ ...base, graceStart: 1, graceMonths: -1 }), RangeError);
  assert.throws(() => buildSchedule({ ...base, graceStart: 1.5, graceMonths: 1 }), RangeError);
  assert.doesNotThrow(() => buildSchedule({ ...base, graceStart: 1, graceMonths: 11 }));
  assert.doesNotThrow(() => buildSchedule({ ...base, graceStart: 11, graceMonths: 1 }));
});

test('отсрочка продлевает срок: платежей по долгу столько же, сколько без отсрочки, строк больше', () => {
  const plain = buildSchedule({ amount: 250_000, ratePercent: 15.4, months: 240, type: 'annuity' });
  const ext = buildSchedule({ amount: 250_000, ratePercent: 15.4, months: 240, type: 'annuity', graceStart: 1, graceMonths: 6, graceExtendsTerm: true });
  assert.equal(ext.rows.length, 246);
  assert.equal(ext.totalMonths, 246);
  assert.equal(ext.payingMonths, 240);
  assert.equal(ext.rows[6].payment, plain.firstPayment, 'платёж после отсрочки равен обычному аннуитету на 240 мес.');
  assert.equal(ext.lastPayment, plain.lastPayment);
  assert.equal(ext.rows[0].payment, 3208.33); // 250 000 * 15.4% / 12
  assert.ok(new Big(ext.totalInterest).eq(new Big(plain.totalInterest).plus(ext.graceInterest)));
  // Отсрочка в конце заданного срока тоже допустима: месяцы 240–242, затем платёж 243-й
  const tail = buildSchedule({ amount: 250_000, ratePercent: 15.4, months: 240, type: 'annuity', graceStart: 240, graceMonths: 3, graceExtendsTerm: true });
  assert.equal(tail.rows.length, 243);
  assert.throws(() => buildSchedule({ amount: 250_000, ratePercent: 15.4, months: 240, type: 'annuity', graceStart: 241, graceMonths: 3, graceExtendsTerm: true }), RangeError);
});

test('переплата совпадает с банковским расчётником: 250 000, 15.4%, 239 мес., отсрочка 12', () => {
  const r = buildSchedule({ amount: 250_000, ratePercent: 15.4, months: 239, type: 'annuity', graceStart: 1, graceMonths: 12 });
  assert.equal(r.rows.length, 239);
  assert.equal(r.rows[0].payment, 3208.33);
  assert.equal(r.rows[12].payment, 3396.21);
  assert.equal(r.graceInterest, 38500);
  assert.equal(r.totalInterest, 559439.55); // цифра из банковского расчётника
  assert.equal(r.totalPaid, 809439.55);
});

test('дифференцированный: переплата по формуле S*r*(n+1)/2', () => {
  const r = buildSchedule({ amount: 120_000, ratePercent: 12, months: 12, type: 'diff' });
  assert.equal(r.totalInterest, 7800); // 120 000 * 0.01 * 13 / 2
});
