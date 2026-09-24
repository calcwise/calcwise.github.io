/*
 * Построение графика платежей.
 *
 * Методика банковских расчётников: месячная ставка = годовая / 12, проценты
 * начисляются на остаток долга на начало месяца, график считается с полной
 * точностью, округление до копеек только при выводе (см. money.ts).
 *
 * События, после которых платёж пересчитывается на остаток и оставшийся срок:
 *  - смена ставки (новый период из rates);
 *  - окончание отсрочки (в отсрочку платятся только проценты, долг не меняется);
 *  - досрочное погашение в режиме «уменьшить платёж».
 * Досрочное погашение «уменьшить срок» платёж не трогает: долг закрывается раньше,
 * а при следующем пересчёте срок берётся тот, который подразумевает текущий платёж.
 */
import { Big, MONTHS_IN_YEAR, annuityPayment, monthlyRate, toMoney, trim } from './money.ts';
import type {
  Prepayment,
  ScheduleInput,
  ScheduleResult,
  ScheduleRow,
  ScheduleSummary,
} from './types.ts';
import { plannedMonths, validateInput } from './validate.ts';

/** Порог, ниже которого остаток считаем нулём: хвост точности деления, не деньги */
const ZERO = new Big('0.000001');

interface MonthPrepayment {
  amount: Big;
  reducePayment: boolean;
}

/** Раскладывает досрочки с повторами по месяцам графика */
function expandPrepayments(prepayments: Prepayment[], total: number): Map<number, MonthPrepayment> {
  const byMonth = new Map<number, MonthPrepayment>();
  const add = (month: number, p: Prepayment) => {
    const current = byMonth.get(month) ?? { amount: new Big(0), reducePayment: false };
    current.amount = current.amount.plus(p.amount);
    current.reducePayment = current.reducePayment || p.mode === 'payment';
    byMonth.set(month, current);
  };
  for (const p of prepayments) {
    const until = Math.min(p.untilMonth ?? total, total);
    if (p.repeat === 'once') {
      if (p.month <= total) add(p.month, p);
      continue;
    }
    const step = p.repeat === 'monthly' ? 1 : MONTHS_IN_YEAR;
    for (let m = p.month; m <= until; m += step) add(m, p);
  }
  return byMonth;
}

/**
 * Сколько месяцев нужно, чтобы закрыть остаток S платежом P при ставке r.
 * Для аннуитета: n = −ln(1 − S·r/P) / ln(1+r). Возвращает целое, не меньше 1.
 */
function impliedAnnuityTerm(balance: Big, rate: Big, payment: Big): number {
  if (payment.lte(0)) return 1;
  if (rate.eq(0)) return Math.max(1, Math.ceil(Number(balance.div(payment).toString())));
  const ratio = Number(balance.times(rate).div(payment).toString());
  if (ratio >= 1) return Number.MAX_SAFE_INTEGER;
  const n = -Math.log(1 - ratio) / Math.log(1 + Number(rate.toString()));
  return Math.max(1, Math.ceil(n - 1e-9));
}

export function buildSchedule(rawInput: ScheduleInput): ScheduleResult {
  const input = validateInput(rawInput);
  const total = plannedMonths(input);
  const amount = new Big(input.amount);

  const graceFlags = new Array<boolean>(total + 1).fill(false);
  for (const g of input.gracePeriods) {
    for (let m = g.start; m < g.start + g.months; m++) graceFlags[m] = true;
  }
  /* Сколько платёжных (не отсрочных) месяцев остаётся начиная с месяца m включительно */
  const payingLeft = new Array<number>(total + 2).fill(0);
  for (let m = total; m >= 1; m--) payingLeft[m] = payingLeft[m + 1]! + (graceFlags[m] ? 0 : 1);

  const rateAt = (month: number): number => {
    let current = input.rates[0]!.ratePercent;
    for (const r of input.rates) if (r.fromMonth <= month) current = r.ratePercent;
    return current;
  };

  const prepayByMonth = expandPrepayments(input.prepayments, total);

  const rows: ScheduleRow[] = [];
  let balance = amount;
  let paidTotal = new Big(0);
  let paidPrincipal = new Big(0);
  let paidInterest = new Big(0);
  let paidPrepay = new Big(0);
  let graceInterest = new Big(0);

  /* Текущие параметры платёжного сегмента */
  let fixedPayment = new Big(0); // аннуитет
  let fixedPrincipal = new Big(0); // дифференцированный
  let segmentRate: Big | null = null;
  let needRecalc = true;
  /* После досрочки «в срок» оставшийся срок задаёт платёж, а не план */
  let termShortened = false;
  let prevRatePercent: number | null = null;

  for (let month = 1; month <= total; month++) {
    const ratePercent = rateAt(month);
    const rate = monthlyRate(ratePercent);
    const isGrace = graceFlags[month]!;
    const isPlannedLast = month === total;

    if (prevRatePercent !== null && ratePercent !== prevRatePercent) needRecalc = true;
    prevRatePercent = ratePercent;

    if (!isGrace && needRecalc) {
      let remaining = payingLeft[month]!;
      if (termShortened && segmentRate !== null) {
        remaining =
          input.type === 'annuity'
            ? Math.min(remaining, impliedAnnuityTerm(balance, segmentRate, fixedPayment))
            : Math.min(
                remaining,
                Math.max(1, Math.ceil(Number(balance.div(fixedPrincipal).toString()) - 1e-9)),
              );
      }
      if (input.type === 'annuity') fixedPayment = annuityPayment(balance, rate, remaining);
      else fixedPrincipal = trim(balance.div(remaining));
      segmentRate = rate;
      needRecalc = false;
    }

    const interest = trim(balance.times(rate));
    let principal: Big;
    let payment: Big;

    if (isGrace) {
      principal = new Big(0);
      payment = interest;
      graceInterest = graceInterest.plus(interest);
      /* После отсрочки платёж считается заново на остаток и оставшиеся месяцы */
      if (!graceFlags[month + 1]) needRecalc = true;
    } else {
      principal = input.type === 'annuity' ? fixedPayment.minus(interest) : fixedPrincipal;
      if (principal.lt(0)) {
        throw new RangeError(
          `Месяц ${month}: платёж меньше начисленных процентов, долг не уменьшается. Проверьте ставку и срок.`,
        );
      }
      if (isPlannedLast || principal.gt(balance)) principal = balance;
      payment = principal.plus(interest);
    }

    let prepayment = new Big(0);
    const extra = prepayByMonth.get(month);
    if (extra && !isPlannedLast) {
      const room = balance.minus(principal);
      prepayment = extra.amount.gt(room) ? room : extra.amount;
      if (prepayment.gt(0)) {
        if (extra.reducePayment) needRecalc = true;
        else termShortened = true;
      }
    }

    balance = trim(balance.minus(principal).minus(prepayment));
    /* Хвост точности после деления — не копейки, а артефакт: гасим его последним платежом */
    if (balance.abs().lt(ZERO)) {
      principal = principal.plus(balance);
      payment = principal.plus(interest);
      balance = new Big(0);
    }

    paidTotal = paidTotal.plus(payment).plus(prepayment);
    paidPrincipal = paidPrincipal.plus(principal).plus(prepayment);
    paidInterest = paidInterest.plus(interest);
    paidPrepay = paidPrepay.plus(prepayment);

    rows.push({
      month,
      isGrace,
      ratePercent,
      payment: toMoney(payment),
      principal: toMoney(principal),
      interest: toMoney(interest),
      prepayment: toMoney(prepayment),
      total: toMoney(payment.plus(prepayment)),
      balance: toMoney(balance),
      paidTotal: toMoney(paidTotal),
      paidPrincipal: toMoney(paidPrincipal),
      paidInterest: toMoney(paidInterest),
      remainingTotal: 0,
    });

    if (balance.eq(0)) break;
  }

  const totalPaidNumber = toMoney(paidTotal);
  for (const row of rows) {
    row.remainingTotal = Math.max(0, Math.round((totalPaidNumber - row.paidTotal) * 100) / 100);
  }

  const payments = rows.map((r) => r.payment);
  const regular = rows.find((r) => !r.isGrace) ?? rows[0]!;
  const summary: ScheduleSummary = {
    amount: toMoney(amount),
    type: input.type,
    months: input.months,
    plannedMonths: total,
    actualMonths: rows.length,
    payingMonths: rows.filter((r) => !r.isGrace).length,
    graceMonths: rows.filter((r) => r.isGrace).length,
    graceInterest: toMoney(graceInterest),
    totalPaid: totalPaidNumber,
    totalPrincipal: toMoney(paidPrincipal),
    totalInterest: toMoney(paidInterest),
    totalPrepaid: toMoney(paidPrepay),
    overpaymentPercent: Number(paidInterest.div(amount).times(100).toFixed(2)),
    firstPayment: payments[0]!,
    lastPayment: payments[payments.length - 1]!,
    minPayment: Math.min(...payments),
    maxPayment: Math.max(...payments),
    regularPayment: regular.payment,
  };

  return { input, summary, rows };
}
