/*
 * Доменные типы ипотечного расчёта. Без зависимостей от фреймворка.
 * Денежные значения на выходе — числа с двумя знаками (округлены только для показа),
 * внутренняя арифметика ведётся в big.js — см. schedule.ts.
 */

export type ScheduleType = 'annuity' | 'diff';

/** Период ставки: с какого месяца действует годовая ставка в процентах */
export interface RatePeriod {
  /** Номер месяца, с которого действует ставка (1 — с первого платежа) */
  fromMonth: number;
  ratePercent: number;
}

/** Отсрочка по основному долгу: платятся только проценты */
export interface GracePeriod {
  /** Первый месяц отсрочки */
  start: number;
  /** Длительность в месяцах */
  months: number;
}

/**
 * Досрочное погашение. Сумма идёт в основной долг в указанном месяце
 * вместе с очередным платежом (после начисления процентов за месяц).
 */
export interface Prepayment {
  /** Месяц первого (или единственного) внесения */
  month: number;
  amount: number;
  /**
   * Что пересчитывать после внесения:
   *  term — платёж прежний, кредит закрывается раньше;
   *  payment — срок прежний, платёж пересчитывается на остаток.
   */
  mode: 'term' | 'payment';
  /** Повтор: один раз, каждый месяц или каждые 12 месяцев, начиная с month */
  repeat: 'once' | 'monthly' | 'yearly';
  /** Последний месяц повторов; по умолчанию до конца срока */
  untilMonth?: number;
}

export interface ScheduleInput {
  amount: number | string;
  /** Срок в месяцах. Без graceExtendsTerm включает отсрочки */
  months: number;
  type: ScheduleType;
  /** Ставки по периодам; первая должна начинаться с 1-го месяца. Одна запись — фиксированная ставка */
  rates: RatePeriod[];
  gracePeriods?: GracePeriod[];
  /** true — месяцы отсрочки добавляются к сроку, а не входят в него */
  graceExtendsTerm?: boolean;
  /**
   * Проценты платятся за предыдущий месяц, как в графиках некоторых банков:
   * в строке n они начислены на остаток на начало месяца n−1, в первой строке —
   * на сумму кредита за месяц выдачи. Проценты за последний месяц в график не входят,
   * банк берёт их при закрытии кредита.
   */
  interestInArrears?: boolean;
  prepayments?: Prepayment[];
}

export interface ScheduleRow {
  month: number;
  isGrace: boolean;
  /** Годовая ставка, действовавшая в этом месяце */
  ratePercent: number;
  /** Плановый платёж без досрочки */
  payment: number;
  principal: number;
  interest: number;
  /** Досрочное погашение в этом месяце (0, если не было) */
  prepayment: number;
  /** Всего внесено в этом месяце: платёж + досрочка */
  total: number;
  /** Остаток долга после платежа */
  balance: number;
  paidTotal: number;
  paidPrincipal: number;
  paidInterest: number;
  /** Осталось выплатить всего, включая будущие проценты */
  remainingTotal: number;
}

export interface ScheduleSummary {
  amount: number;
  type: ScheduleType;
  /** Заданный срок */
  months: number;
  /** Число строк планового графика (срок с учётом продления отсрочкой) */
  plannedMonths: number;
  /** Фактическое число месяцев до закрытия долга (меньше планового при досрочках «в срок») */
  actualMonths: number;
  payingMonths: number;
  graceMonths: number;
  graceInterest: number;
  totalPaid: number;
  totalPrincipal: number;
  totalInterest: number;
  totalPrepaid: number;
  overpaymentPercent: number;
  firstPayment: number;
  lastPayment: number;
  minPayment: number;
  maxPayment: number;
  /** Первый обычный платёж вне отсрочки */
  regularPayment: number;
}

export interface ScheduleResult {
  input: Required<Omit<ScheduleInput, 'amount'>> & { amount: number };
  summary: ScheduleSummary;
  rows: ScheduleRow[];
}

/** Итог по календарному году кредита (12 строк графика) */
export interface YearSummary {
  year: number;
  fromMonth: number;
  toMonth: number;
  paid: number;
  principal: number;
  interest: number;
  prepayment: number;
  balance: number;
}
