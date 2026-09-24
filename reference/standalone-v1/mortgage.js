/**
 * Ипотечный калькулятор: аннуитетный и дифференцированный график платежей.
 *
 * Чистая библиотека расчёта без зависимостей от окружения: работает
 * в браузере (index.html) и в Node (тесты). Все денежные расчёты ведутся
 * через big.js, чтобы исключить ошибки двоичной арифметики с плавающей
 * точкой.
 *
 * Методика такая же, как в банковских расчётниках: график считается с полной
 * точностью (аннуитет и проценты не округляются между месяцами), и только
 * итоговые значения каждой строки округляются до копеек для показа.
 * Поэтому переплата совпадает с банковской, а сумма округлённых строк
 * может отличаться от итога на несколько копеек.
 *
 * Допущения:
 *  - ставка годовая, месячная ставка = годовая / 12 / 100;
 *  - проценты начисляются на остаток долга на начало месяца;
 *  - платежи ежемесячные, первый платёж через месяц после выдачи.
 *
 * Использование:
 *   const { buildSchedule } = require('./mortgage');           // Node
 *   const { buildSchedule } = window.Mortgage;                  // браузер
 *   buildSchedule({ amount: 3_000_000, ratePercent: 12, months: 240, type: 'annuity' });
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('big.js'));
  } else {
    root.Mortgage = factory(root.Big);
  }
})(typeof self !== 'undefined' ? self : this, function (Big) {
'use strict';

if (!Big) {
  throw new Error('big.js не найден: подключите его до mortgage.js');
}

// Достаточная точность для деления и возведения в степень.
Big.DP = 40;
Big.RM = Big.roundHalfUp;

const MONEY_DP = 2;
const MONTHS_IN_YEAR = 12;

const SCHEDULE_TYPES = Object.freeze({
  ANNUITY: 'annuity',
  DIFFERENTIATED: 'diff',
});

/**
 * Округление до копеек.
 * @param {Big} value
 * @returns {Big}
 */
const toMoney = (value) => value.round(MONEY_DP, Big.roundHalfUp);

/**
 * Проверка входных параметров. Бросает ошибку с понятным сообщением.
 * @param {{amount: number|string, ratePercent: number|string, months: number}} params
 */
const validateInput = ({ amount, ratePercent, months, graceStart, graceMonths, graceExtendsTerm }) => {
  let amountBig;
  let rateBig;

  try {
    amountBig = new Big(amount);
  } catch {
    throw new TypeError(`Сумма кредита должна быть числом, получено: ${amount}`);
  }
  try {
    rateBig = new Big(ratePercent);
  } catch {
    throw new TypeError(`Ставка должна быть числом, получено: ${ratePercent}`);
  }

  if (amountBig.lte(0)) {
    throw new RangeError('Сумма кредита должна быть больше 0');
  }
  if (rateBig.lt(0)) {
    throw new RangeError('Ставка не может быть отрицательной');
  }
  if (!Number.isInteger(months) || months < 1) {
    throw new RangeError(`Срок должен быть целым числом месяцев >= 1, получено: ${months}`);
  }
  if (!Number.isInteger(graceMonths) || graceMonths < 0) {
    throw new RangeError(`Отсрочка должна быть целым числом месяцев >= 0, получено: ${graceMonths}`);
  }
  if (!Number.isInteger(graceStart) || graceStart < 1) {
    throw new RangeError(`Месяц начала отсрочки должен быть целым числом >= 1, получено: ${graceStart}`);
  }
  if (graceMonths > 0) {
    const totalMonths = graceExtendsTerm ? months + graceMonths : months;
    if (graceStart + graceMonths - 1 >= totalMonths) {
      throw new RangeError(
        'Отсрочка должна закончиться раньше последнего месяца: после неё нужен хотя бы один платёж по основному долгу',
      );
    }
  }

  return { amountBig, rateBig };
};

/**
 * Месячная ставка в долях единицы: годовая% / 100 / 12.
 * @param {Big} ratePercent
 * @returns {Big}
 */
const getMonthlyRate = (ratePercent) => ratePercent.div(100).div(MONTHS_IN_YEAR);

/**
 * Аннуитетный платёж (до округления).
 * P = S * r * (1+r)^n / ((1+r)^n - 1); при r = 0 -> S / n.
 * @param {Big} amount
 * @param {Big} monthlyRate
 * @param {number} months
 * @returns {Big}
 */
const getAnnuityPayment = (amount, monthlyRate, months) => {
  if (monthlyRate.eq(0)) {
    return amount.div(months);
  }
  const factor = monthlyRate.plus(1).pow(months); // (1+r)^n
  return amount.times(monthlyRate).times(factor).div(factor.minus(1));
};

/**
 * Общий цикл построения графика. Стратегия задаёт размер платежа
 * или части основного долга на каждый месяц.
 *
 * @param {Big} amount
 * @param {Big} monthlyRate
 * @param {number} months
 * @param {(ctx: {month: number, balance: Big, interest: Big}) => {payment?: Big, principal?: Big}} strategy
 */
const runSchedule = (amount, monthlyRate, months, strategy, isGraceMonth = () => false) => {
  const rows = [];
  let balance = amount;
  let paidTotal = new Big(0);
  let paidPrincipal = new Big(0);
  let paidInterest = new Big(0);

  for (let month = 1; month <= months; month++) {
    const isLast = month === months;
    const isGrace = !isLast && isGraceMonth(month);
    const interest = balance.times(monthlyRate);

    let principal;
    let payment;

    if (isGrace) {
      // Отсрочка: платятся только проценты, долг не уменьшается.
      principal = new Big(0);
      payment = interest;
    } else if (isLast) {
      // Последний платёж закрывает долг ровно в 0 (снимает остаток точности деления).
      principal = balance;
      payment = principal.plus(interest);
    } else {
      const step = strategy({ month, balance, interest });
      if (step.payment !== undefined) {
        payment = step.payment;
        principal = payment.minus(interest);
      } else {
        principal = step.principal;
        payment = principal.plus(interest);
      }
      // Защита от переплаты: основной долг не может превысить остаток.
      if (principal.gt(balance)) {
        principal = balance;
        payment = principal.plus(interest);
      }
    }

    if (principal.lt(0)) {
      throw new Error(
        `Месяц ${month}: платёж меньше начисленных процентов, долг не уменьшается. Проверьте ставку и срок.`,
      );
    }

    balance = balance.minus(principal);
    paidTotal = paidTotal.plus(payment);
    paidPrincipal = paidPrincipal.plus(principal);
    paidInterest = paidInterest.plus(interest);

    rows.push({
      month,
      isGrace,
      payment,
      principal,
      interest,
      balance,
      paidTotal,
      paidPrincipal,
      paidInterest,
      remainingTotal: null, // заполняется ниже, когда известна общая сумма выплат
    });
  }

  const totalPaid = paidTotal;
  for (const row of rows) {
    row.remainingTotal = totalPaid.minus(row.paidTotal);
  }

  return {
    rows,
    totalPaid,
    totalPrincipal: paidPrincipal,
    totalInterest: paidInterest,
  };
};

/**
 * Преобразует Big в число с 2 знаками для удобного использования.
 * @param {Big} value
 * @returns {number}
 */
const toNumber = (value) => Number(toMoney(value).toFixed(MONEY_DP));

/**
 * @typedef {Object} ScheduleRow
 * @property {number} month           Номер месяца
 * @property {boolean} isGrace        Месяц отсрочки: платятся только проценты
 * @property {number} payment         Полный платёж за месяц
 * @property {number} principal       Часть платежа в счёт основного долга
 * @property {number} interest        Часть платежа в счёт процентов
 * @property {number} balance         Остаток основного долга после платежа
 * @property {number} paidTotal       Выплачено всего с начала (нарастающим итогом)
 * @property {number} paidPrincipal   Выплачено основного долга с начала
 * @property {number} paidInterest    Выплачено процентов с начала
 * @property {number} remainingTotal  Осталось выплатить всего (с учётом будущих процентов)
 */

/**
 * @typedef {Object} ScheduleResult
 * @property {'annuity'|'diff'} type
 * @property {number} amount
 * @property {number} ratePercent
 * @property {number} months           Срок, как он задан на входе
 * @property {number} totalMonths      Число строк в графике (срок + отсрочка, если она продлевает срок)
 * @property {number} payingMonths     Число месяцев с платежами по основному долгу
 * @property {boolean} graceExtendsTerm
 * @property {number|null} graceStart  Месяц начала отсрочки или null, если её нет
 * @property {number} graceMonths      Длительность отсрочки в месяцах
 * @property {number} graceInterest    Проценты, уплаченные за месяцы отсрочки
 * @property {number} firstPayment
 * @property {number} lastPayment
 * @property {number} minPayment
 * @property {number} maxPayment
 * @property {number} totalPaid        Всего выплачено за весь срок
 * @property {number} totalPrincipal   Всего основного долга (равно сумме кредита)
 * @property {number} totalInterest    Переплата по процентам
 * @property {number} overpaymentPercent Переплата в % от суммы кредита
 * @property {ScheduleRow[]} rows
 */

/**
 * Строит график платежей.
 *
 * @param {Object} params
 * @param {number|string} params.amount       Сумма кредита
 * @param {number|string} params.ratePercent  Годовая ставка в процентах (например 12 для 12%)
 * @param {number} params.months              Срок в месяцах. Если graceExtendsTerm = false — включает отсрочку,
 *                                            иначе это число платёжных месяцев, а отсрочка добавляется сверху
 * @param {'annuity'|'diff'} [params.type='annuity']
 * @param {number} [params.graceStart=1]      Месяц, с которого начинается отсрочка по основному долгу
 * @param {number} [params.graceMonths=0]     Длительность отсрочки в месяцах (0 — без отсрочки).
 *                                            В эти месяцы платятся только проценты.
 * @param {boolean} [params.graceExtendsTerm=false]
 *        false — отсрочка внутри срока: долг гасится за months - graceMonths платежей, строк в графике months.
 *        true  — отсрочка продлевает срок: долг гасится за months платежей, строк в графике months + graceMonths.
 * @returns {ScheduleResult}
 */
const buildSchedule = ({
  amount,
  ratePercent,
  months,
  type = SCHEDULE_TYPES.ANNUITY,
  graceStart = 1,
  graceMonths = 0,
  graceExtendsTerm = false,
}) => {
  graceExtendsTerm = Boolean(graceExtendsTerm);
  const { amountBig, rateBig } = validateInput({ amount, ratePercent, months, graceStart, graceMonths, graceExtendsTerm });
  const monthlyRate = getMonthlyRate(rateBig);

  const graceEnd = graceStart + graceMonths - 1;
  const isGraceMonth = (month) => graceMonths > 0 && month >= graceStart && month <= graceEnd;
  const totalMonths = graceExtendsTerm ? months + graceMonths : months;
  const payingMonths = totalMonths - graceMonths;

  let strategy;

  if (type === SCHEDULE_TYPES.ANNUITY) {
    // В отсрочку долг не меняется, поэтому аннуитет считается сразу на все платёжные месяцы.
    const payment = getAnnuityPayment(amountBig, monthlyRate, payingMonths);
    strategy = () => ({ payment });
  } else if (type === SCHEDULE_TYPES.DIFFERENTIATED) {
    const principal = amountBig.div(payingMonths);
    strategy = () => ({ principal });
  } else {
    throw new RangeError(`Неизвестный тип графика: ${type}. Допустимо: annuity, diff`);
  }

  const raw = runSchedule(amountBig, monthlyRate, totalMonths, strategy, isGraceMonth);
  const graceInterest = raw.rows
    .filter((r) => r.isGrace)
    .reduce((acc, r) => acc.plus(r.interest), new Big(0));

  const payments = raw.rows.map((r) => r.payment);
  const minPayment = payments.reduce((a, b) => (b.lt(a) ? b : a));
  const maxPayment = payments.reduce((a, b) => (b.gt(a) ? b : a));

  return {
    type,
    amount: toNumber(amountBig),
    ratePercent: Number(rateBig.toString()),
    months,
    totalMonths,
    payingMonths,
    graceStart: graceMonths > 0 ? graceStart : null,
    graceMonths,
    graceExtendsTerm,
    graceInterest: toNumber(graceInterest),
    firstPayment: toNumber(payments[0]),
    lastPayment: toNumber(payments[payments.length - 1]),
    minPayment: toNumber(minPayment),
    maxPayment: toNumber(maxPayment),
    totalPaid: toNumber(raw.totalPaid),
    totalPrincipal: toNumber(raw.totalPrincipal),
    totalInterest: toNumber(raw.totalInterest),
    overpaymentPercent: Number(raw.totalInterest.div(amountBig).times(100).toFixed(2)),
    rows: raw.rows.map((r) => ({
      month: r.month,
      isGrace: r.isGrace,
      payment: toNumber(r.payment),
      principal: toNumber(r.principal),
      interest: toNumber(r.interest),
      balance: toNumber(r.balance),
      paidTotal: toNumber(r.paidTotal),
      paidPrincipal: toNumber(r.paidPrincipal),
      paidInterest: toNumber(r.paidInterest),
      remainingTotal: toNumber(r.remainingTotal),
    })),
  };
};

// ---------------------------------------------------------------------------
// Метаданные для отображения и экспорт
// ---------------------------------------------------------------------------

const TYPE_LABELS = Object.freeze({
  [SCHEDULE_TYPES.ANNUITY]: 'Аннуитетный (равные платежи)',
  [SCHEDULE_TYPES.DIFFERENTIATED]: 'Дифференцированный (убывающие платежи)',
});

const COLUMNS = Object.freeze([
  { key: 'month', title: '№', money: false },
  { key: 'payment', title: 'Платёж' },
  { key: 'principal', title: 'Основной долг' },
  { key: 'interest', title: 'Проценты' },
  { key: 'balance', title: 'Остаток долга' },
  { key: 'paidTotal', title: 'Выплачено всего' },
  { key: 'paidPrincipal', title: 'Выплачено долга' },
  { key: 'paidInterest', title: 'Выплачено процентов' },
  { key: 'remainingTotal', title: 'Осталось выплатить' },
]);

/**
 * Возвращает CSV (разделитель `;`, десятичная запятая) для открытия в Excel/Numbers.
 * @param {ScheduleResult} result
 * @returns {string}
 */
const toCsv = (result) => {
  const csvNum = (n) => n.toFixed(2).replace('.', ',');
  const header = [...COLUMNS.map((c) => c.title), 'Отсрочка'].join(';');
  const body = result.rows.map((row) =>
    [
      ...COLUMNS.map((c) => (c.money === false ? String(row[c.key]) : csvNum(row[c.key]))),
      row.isGrace ? 'да' : '',
    ].join(';'),
  );
  return [header, ...body].join('\n') + '\n';
};

return {
  SCHEDULE_TYPES,
  TYPE_LABELS,
  COLUMNS,
  buildSchedule,
  toCsv,
  getAnnuityPayment,
  getMonthlyRate,
};
});
