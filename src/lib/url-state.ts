/*
 * Состояние калькулятора в адресной строке: расчёт можно отправить ссылкой
 * и вернуться к нему. Ключи короткие, значения человекочитаемые.
 *
 *   a=250000        сумма
 *   n=239           срок в месяцах
 *   t=annuity|diff  тип
 *   r=15.4          ставка; периоды через запятую как «ставка@месяц»: r=5@1,15@13
 *   g=1x12,61x3     отсрочки «начало x месяцев»
 *   ge=1            отсрочка продлевает срок
 *   ia=1            проценты платятся за предыдущий месяц
 *   x=3396.21       дополнительная переплата; без ключа — один платёж по умолчанию
 *   p=12:500000:term:once,1:5000:term:monthly:60:budget
 *                   досрочки «месяц:сумма:режим:повтор», дальше в любом порядке число —
 *                   последний месяц повторов, слово budget — «всего в месяц» (сумма
 *                   включает плановый платёж). Старые короткие формы t/p, o/m/y, b читаются.
 *   y=1             срок показан в годах
 */
import type { Prepayment, ScheduleInput } from './mortgage/index.ts';

export interface CalculatorState extends ScheduleInput {
  amount: number;
  /** Срок в форме показан в годах, а не месяцах */
  termInYears: boolean;
  /**
   * Дополнительная переплата сверх графика, введённая пользователем.
   * undefined — значение по умолчанию (см. extraOverpayment в schedule-render.ts)
   */
  extraOverpayment?: number;
}

export const DEFAULT_STATE: CalculatorState = {
  amount: 250_000,
  months: 240,
  type: 'annuity',
  rates: [{ fromMonth: 1, ratePercent: 15.4 }],
  gracePeriods: [],
  graceExtendsTerm: false,
  interestInArrears: false,
  prepayments: [],
  termInYears: true,
};

const MODE_BACK: Record<string, Prepayment['mode']> = {
  t: 'term',
  p: 'payment',
  term: 'term',
  payment: 'payment',
};
const REPEAT_BACK: Record<string, Prepayment['repeat']> = {
  o: 'once',
  m: 'monthly',
  y: 'yearly',
  once: 'once',
  monthly: 'monthly',
  yearly: 'yearly',
};

const num = (n: number) => String(Math.round(n * 100) / 100);

export function encodeState(state: CalculatorState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('a', num(state.amount));
  params.set('n', String(state.months));
  params.set('t', state.type);
  params.set(
    'r',
    state.rates.length === 1 && state.rates[0]!.fromMonth === 1
      ? num(state.rates[0]!.ratePercent)
      : state.rates.map((r) => `${num(r.ratePercent)}@${r.fromMonth}`).join(','),
  );
  if (state.gracePeriods?.length) {
    params.set('g', state.gracePeriods.map((g) => `${g.start}x${g.months}`).join(','));
    if (state.graceExtendsTerm) params.set('ge', '1');
  }
  if (state.prepayments?.length) {
    params.set(
      'p',
      state.prepayments
        .map((p) => {
          const parts = [String(p.month), num(p.amount), p.mode, p.repeat];
          if (p.untilMonth !== undefined) parts.push(String(p.untilMonth));
          if (p.kind === 'budget') parts.push('budget');
          return parts.join(':');
        })
        .join(','),
    );
  }
  if (state.interestInArrears) params.set('ia', '1');
  if (state.extraOverpayment !== undefined) params.set('x', num(state.extraOverpayment));
  if (!state.termInYears) params.set('y', '0');
  return params;
}

/** Разбирает адрес; битые значения молча заменяются значениями по умолчанию */
export function decodeState(
  params: URLSearchParams,
  fallback: CalculatorState = DEFAULT_STATE,
): CalculatorState {
  const state: CalculatorState = {
    ...fallback,
    rates: [...fallback.rates],
    gracePeriods: [...(fallback.gracePeriods ?? [])],
    prepayments: [...(fallback.prepayments ?? [])],
  };
  const number = (key: string) => {
    const raw = params.get(key);
    if (raw === null) return null;
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  const a = number('a');
  if (a !== null && a > 0) state.amount = a;
  const n = number('n');
  if (n !== null && Number.isInteger(n) && n > 0) state.months = n;
  const t = params.get('t');
  if (t === 'annuity' || t === 'diff') state.type = t;

  const r = params.get('r');
  if (r) {
    const rates = r
      .split(',')
      .map((chunk) => {
        const [rate, from = '1'] = chunk.split('@');
        return { ratePercent: Number(rate!.replace(',', '.')), fromMonth: Number(from) };
      })
      .filter(
        (x) =>
          Number.isFinite(x.ratePercent) &&
          x.ratePercent >= 0 &&
          Number.isInteger(x.fromMonth) &&
          x.fromMonth >= 1,
      )
      .sort((x, y) => x.fromMonth - y.fromMonth);
    if (rates.length && rates[0]!.fromMonth === 1) state.rates = rates;
  }

  const g = params.get('g');
  if (g !== null) {
    state.gracePeriods = g
      .split(',')
      .filter(Boolean)
      .map((chunk) => {
        const [start, months] = chunk.split('x').map(Number);
        return { start: start!, months: months! };
      })
      .filter(
        (x) =>
          Number.isInteger(x.start) && x.start >= 1 && Number.isInteger(x.months) && x.months >= 1,
      );
    state.graceExtendsTerm = params.get('ge') === '1';
  }

  const p = params.get('p');
  if (p !== null) {
    state.prepayments = p
      .split(',')
      .filter(Boolean)
      .map((chunk): Prepayment | null => {
        const [month, amount, mode = 'term', repeat = 'once', ...tail] = chunk.split(':');
        const item: Prepayment = {
          month: Number(month),
          amount: Number(amount!.replace(',', '.')),
          mode: MODE_BACK[mode] ?? 'term',
          repeat: REPEAT_BACK[repeat] ?? 'once',
        };
        for (const part of tail) {
          if (/^\d+$/.test(part)) item.untilMonth = Number(part);
          else if (part === 'budget' || part === 'b') item.kind = 'budget';
        }
        return Number.isInteger(item.month) && item.month >= 1 && item.amount > 0 ? item : null;
      })
      .filter((x): x is Prepayment => x !== null);
  }

  state.interestInArrears = params.get('ia') === '1';
  const x = number('x');
  if (x !== null && x >= 0) state.extraOverpayment = x;
  else delete state.extraOverpayment;
  if (params.get('y') === '0') state.termInYears = false;
  return state;
}

/**
 * Строка запроса для адресной строки и ссылок. URLSearchParams кодирует двоеточия,
 * запятые и @ как %3A, %2C и %40, хотя в запросе они разрешены как есть, — адрес
 * должен читаться человеком, поэтому собираем строку сами.
 */
export function stateQuery(state: CalculatorState): string {
  return Array.from(encodeState(state))
    .map(
      ([key, value]) =>
        `${key}=${encodeURIComponent(value).replace(/%3A/gi, ':').replace(/%2C/gi, ',').replace(/%40/gi, '@')}`,
    )
    .join('&');
}

/** Ссылка на текущий расчёт для кнопки «Скопировать ссылку» */
export function stateUrl(state: CalculatorState, base: string): string {
  const url = new URL(base);
  url.search = stateQuery(state);
  return url.toString();
}
