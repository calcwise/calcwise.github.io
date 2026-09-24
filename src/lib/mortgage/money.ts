/*
 * Денежная арифметика на big.js.
 * Методика как в банковских расчётниках: график считается с полной точностью,
 * до копеек округляются только значения для показа. Поэтому итоговая переплата
 * совпадает с банковской, а сумма округлённых строк может отличаться на копейки.
 */
import Big from 'big.js';

Big.DP = 30;
Big.RM = Big.roundHalfUp;

export { Big };

export const MONEY_DP = 2;
export const MONTHS_IN_YEAR = 12;

/**
 * Рабочая точность промежуточных значений. Умножение в big.js точное, и без
 * округления число знаков растёт с каждым месяцем — расчёт на 30 лет занимал
 * полсекунды. 12 знаков после запятой дают погрешность порядка 1e-10 за весь
 * срок, что на восемь порядков меньше копейки.
 */
export const WORK_DP = 12;
export const trim = (value: Big): Big => value.round(WORK_DP, Big.roundHalfUp);

/** (1+r)^n возведением в квадрат с подрезкой знаков на каждом шаге */
export function powTrim(base: Big, exponent: number): Big {
  let result = new Big(1);
  let b = base;
  let e = exponent;
  while (e > 0) {
    if (e % 2 === 1) result = result.times(b).round(Big.DP, Big.roundHalfUp);
    e = Math.floor(e / 2);
    if (e > 0) b = b.times(b).round(Big.DP, Big.roundHalfUp);
  }
  return result;
}

export const toMoney = (value: Big): number =>
  Number(value.round(MONEY_DP, Big.roundHalfUp).toFixed(MONEY_DP));

export const monthlyRate = (ratePercent: Big | number): Big =>
  new Big(ratePercent).div(100).div(MONTHS_IN_YEAR);

/**
 * Аннуитетный платёж на остаток S, месячную ставку r и n месяцев:
 * P = S·r·(1+r)^n / ((1+r)^n − 1); при r = 0 → S / n.
 */
export function annuityPayment(balance: Big, rate: Big, months: number): Big {
  if (months <= 0) return balance;
  if (rate.eq(0)) return balance.div(months);
  const factor = powTrim(rate.plus(1), months);
  return trim(balance.times(rate).times(factor).div(factor.minus(1)));
}

/**
 * Аннуитетный платёж при процентах «за предыдущий месяц»: остаток после m платежей
 * B_m = B_{m−1} − P + r·B_{m−2}, в первом месяце проценты уже известны (prevOpening·prevRate).
 * Остаток линеен по P: B_n = b_n − P·k_n, поэтому P = b_n / k_n закрывает долг ровно за n месяцев.
 */
export function annuityPaymentArrears(
  balance: Big,
  prevOpening: Big,
  prevRate: Big,
  rate: Big,
  months: number,
): Big {
  if (months <= 0) return balance;
  let bPrev = balance; // b_{m−2}
  let kPrev = new Big(0);
  let b = trim(balance.plus(prevOpening.times(prevRate))); // b_1
  let k = new Big(1);
  for (let m = 2; m <= months; m++) {
    const bNext = trim(b.plus(rate.times(bPrev)));
    const kNext = trim(k.plus(1).plus(rate.times(kPrev)));
    bPrev = b;
    kPrev = k;
    b = bNext;
    k = kNext;
  }
  return trim(b.div(k));
}

/** Число из строки с пробелами и запятой: «3 000 000,50» → 3000000.5. NaN, если не число */
export function parseAmount(raw: string | number): number {
  if (typeof raw === 'number') return raw;
  const normalized = raw.replace(/[\s ]/g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}
