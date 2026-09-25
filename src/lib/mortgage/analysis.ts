/*
 * Производные расчёты поверх графика: сводка по годам, эффект досрочных
 * погашений, чувствительность к ставке и сроку, обратный расчёт.
 */
import { buildSchedule } from './schedule.ts';
import type { ScheduleInput, ScheduleResult, YearSummary } from './types.ts';

/** Самый длинный срок, который принимает калькулятор (см. validate.ts) */
const MAX_MONTHS = 600;

export function yearSummaries(result: ScheduleResult): YearSummary[] {
  const years: YearSummary[] = [];
  for (let i = 0; i < result.rows.length; i += 12) {
    const chunk = result.rows.slice(i, i + 12);
    const last = chunk[chunk.length - 1]!;
    const sum = (key: 'total' | 'principal' | 'interest' | 'prepayment') =>
      Math.round(chunk.reduce((acc, r) => acc + r[key], 0) * 100) / 100;
    years.push({
      year: i / 12 + 1,
      fromMonth: chunk[0]!.month,
      toMonth: last.month,
      paid: sum('total'),
      principal: Math.round((sum('principal') + sum('prepayment')) * 100) / 100,
      interest: sum('interest'),
      prepayment: sum('prepayment'),
      balance: last.balance,
    });
  }
  return years;
}

export interface PrepaymentEffect {
  baseline: ScheduleResult;
  withPrepayments: ScheduleResult;
  /** Сэкономлено на процентах */
  interestSaved: number;
  /** На сколько месяцев раньше закрыт кредит */
  monthsSaved: number;
  /** Насколько ниже стал обычный платёж (для режима «уменьшить платёж») */
  paymentReduced: number;
}

/** Тот же кредит без досрочных погашений и разница с ним */
export function prepaymentEffect(result: ScheduleResult): PrepaymentEffect | null {
  if (result.input.prepayments.length === 0) return null;
  const baseline = buildSchedule({ ...result.input, prepayments: [] });
  /* Снижение платежа есть только в режиме «уменьшить платёж»: сравниваем платёж
     в месяце после первой такой досрочки с платежом того же месяца без досрочек */
  const firstReducing = result.rows.find(
    (r) =>
      r.prepayment > 0 &&
      result.input.prepayments.some((p) => p.mode === 'payment' && p.month <= r.month),
  );
  let paymentReduced = 0;
  if (firstReducing) {
    const after = result.rows.find((r) => r.month > firstReducing.month && !r.isGrace);
    const same = after ? baseline.rows[after.month - 1] : undefined;
    if (after && same)
      paymentReduced = Math.max(0, Math.round((same.payment - after.payment) * 100) / 100);
  }
  return {
    baseline,
    withPrepayments: result,
    interestSaved:
      Math.round((baseline.summary.totalInterest - result.summary.totalInterest) * 100) / 100,
    monthsSaved: baseline.summary.actualMonths - result.summary.actualMonths,
    paymentReduced,
  };
}

export interface SensitivityCell {
  label: string;
  value: number;
  payment: number;
  totalInterest: number;
  isCurrent: boolean;
}

/** Платёж и переплата при ставке ±1 и ±2 процентных пункта */
export function rateSensitivity(
  input: ScheduleInput,
  steps = [-2, -1, 0, 1, 2],
): SensitivityCell[] {
  const base = input.rates[0]!.ratePercent;
  return steps
    .map((delta) => Math.round((base + delta) * 100) / 100)
    .filter((rate) => rate >= 0)
    .map((rate) => {
      const rates = input.rates.map((r, i) =>
        i === 0
          ? { ...r, ratePercent: rate }
          : { ...r, ratePercent: Math.max(0, r.ratePercent + rate - base) },
      );
      const r = buildSchedule({ ...input, rates, prepayments: [] });
      return {
        label: `${formatRate(rate)}%`,
        value: rate,
        payment: r.summary.regularPayment,
        totalInterest: r.summary.totalInterest,
        isCurrent: rate === base,
      };
    });
}

/** Платёж и переплата при сроке в годах из списка */
export function termSensitivity(
  input: ScheduleInput,
  years = [5, 10, 15, 20, 25, 30],
): SensitivityCell[] {
  const currentYears = input.months / 12;
  const list = [...new Set([...years, currentYears])].sort((a, b) => a - b);
  return list
    .map((y) => {
      const months = Math.round(y * 12);
      if (months < 1 || months > 600) return null;
      try {
        const r = buildSchedule({ ...input, months, prepayments: [] });
        return {
          label: formatYears(y),
          value: months,
          payment: r.summary.regularPayment,
          totalInterest: r.summary.totalInterest,
          isCurrent: months === input.months,
        };
      } catch {
        return null;
      }
    })
    .filter((c): c is SensitivityCell => c !== null);
}

/**
 * Обратный расчёт: какую сумму доплачивать ежемесячно, чтобы закрыть кредит
 * за targetMonths. Бинарный поиск по размеру ежемесячной досрочки в режиме «в срок».
 */
export function extraPaymentForTerm(input: ScheduleInput, targetMonths: number): number | null {
  const base = buildSchedule({ ...input, prepayments: [] });
  if (targetMonths >= base.summary.actualMonths || targetMonths < 1) return null;
  const firstPaying = base.rows.find((r) => !r.isGrace)?.month ?? 1;
  let lo = 0;
  let hi = base.summary.amount;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const r = buildSchedule({
      ...input,
      prepayments: [{ month: firstPaying, amount: mid, mode: 'term', repeat: 'monthly' }],
    });
    if (r.summary.actualMonths > targetMonths) lo = mid;
    else hi = mid;
  }
  return Math.ceil(hi * 100) / 100;
}

/** Самый большой плановый платёж графика, без досрочек: то, что банк спишет в худший месяц */
export function maxPlannedPayment(result: ScheduleResult): number {
  return Math.max(...result.rows.map((r) => r.payment));
}

/**
 * Расчёт по платежу: самый короткий срок в месяцах, при котором ни один плановый платёж
 * не больше payment. Для аннуитета это обычный платёж, для дифференцированного — первый,
 * самый большой; при ставке по периодам учитывается самый дорогой период, при отсрочке —
 * проценты в отсрочку. Досрочки в подборе не участвуют: они лишь сокращают срок потом.
 * null — такой платёж не покрывает проценты даже при сроке 50 лет.
 */
export function termForPayment(input: ScheduleInput, payment: number): number | null {
  const fits = (months: number): boolean => {
    try {
      const r = buildSchedule({ ...input, months, prepayments: [] });
      return maxPlannedPayment(r) <= payment + 0.005;
    } catch {
      /* Слишком короткий срок для отсрочки или платёж меньше процентов — не подходит */
      return false;
    }
  };
  if (!(payment > 0) || !fits(MAX_MONTHS)) return null;
  let lo = 1;
  let hi = MAX_MONTHS;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function formatRate(rate: number): string {
  return String(Math.round(rate * 100) / 100).replace('.', ',');
}

export function formatYears(years: number): string {
  const whole = Math.floor(years);
  const months = Math.round((years - whole) * 12);
  const parts: string[] = [];
  if (whole) parts.push(`${whole} ${plural(whole, 'год', 'года', 'лет')}`);
  if (months) parts.push(`${months} ${plural(months, 'месяц', 'месяца', 'месяцев')}`);
  return parts.join(' ') || '0 месяцев';
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
