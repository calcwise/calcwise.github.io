/*
 * Состояние калькулятора в адресной строке: расчёт можно отправить ссылкой
 * и вернуться к нему. Ключи и значения — слова, чтобы адрес читался человеком.
 *
 *   amount=250000            сумма
 *   months=239               срок в месяцах
 *   type=annuity|diff        тип платежей
 *   rate=15.4                ставка; периоды через запятую как «ставка@месяц»: rate=5@1,15@13
 *   grace=1x12,61x3          отсрочки «с месяца x длительность»
 *   grace-extends=1          отсрочка продлевает срок
 *   interest=previous-month  проценты платятся за предыдущий месяц
 *   extra=3396.21            дополнительная переплата; без ключа её нет
 *   prepay=12:500000:term:once,1:5000:term:monthly:60:budget
 *                            досрочки «месяц:сумма:режим:повтор», дальше в любом порядке
 *                            число — последний месяц повторов, слово budget — «всего в
 *                            месяц» (сумма включает плановый платёж)
 *   unit=months              срок в форме показан в месяцах (по умолчанию в годах)
 *
 * Старые короткие ключи (a, n, t, r, g, ge, ia, x, p, y) и короткие формы досрочек
 * (t/p, o/m/y, b) по-прежнему читаются: ссылки, разосланные раньше, не ломаются.
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
  params.set('amount', num(state.amount));
  params.set('months', String(state.months));
  params.set('type', state.type);
  params.set(
    'rate',
    state.rates.length === 1 && state.rates[0]!.fromMonth === 1
      ? num(state.rates[0]!.ratePercent)
      : state.rates.map((r) => `${num(r.ratePercent)}@${r.fromMonth}`).join(','),
  );
  if (state.gracePeriods?.length) {
    params.set('grace', state.gracePeriods.map((g) => `${g.start}x${g.months}`).join(','));
    if (state.graceExtendsTerm) params.set('grace-extends', '1');
  }
  if (state.prepayments?.length) {
    params.set(
      'prepay',
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
  if (state.interestInArrears) params.set('interest', 'previous-month');
  if (state.extraOverpayment !== undefined) params.set('extra', num(state.extraOverpayment));
  if (!state.termInYears) params.set('unit', 'months');
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
  /* Полный ключ в приоритете, короткий — для старых ссылок */
  const get = (key: string, short: string) => params.get(key) ?? params.get(short);
  const number = (key: string, short: string) => {
    const raw = get(key, short);
    if (raw === null) return null;
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  const a = number('amount', 'a');
  if (a !== null && a > 0) state.amount = a;
  const n = number('months', 'n');
  if (n !== null && Number.isInteger(n) && n > 0) state.months = n;
  const t = get('type', 't');
  if (t === 'annuity' || t === 'diff') state.type = t;

  const r = get('rate', 'r');
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

  const g = get('grace', 'g');
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
    state.graceExtendsTerm = get('grace-extends', 'ge') === '1';
  }

  const p = get('prepay', 'p');
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

  const interest = get('interest', 'ia');
  state.interestInArrears = interest === 'previous-month' || interest === '1';
  const x = number('extra', 'x');
  if (x !== null && x >= 0) state.extraOverpayment = x;
  else delete state.extraOverpayment;
  if (get('unit', 'y') === 'months' || params.get('y') === '0') state.termInYears = false;
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

/**
 * Несколько сценариев в одном адресе для страницы сравнения: ключи каждого сценария
 * с номером впереди — 1.amount=250000&1.type=annuity&2.amount=250000&2.type=diff.
 * Так адрес читается так же, как у калькулятора, без вложенного и дважды закодированного
 * запроса.
 */
export function scenariosQuery(states: CalculatorState[]): string {
  return states
    .map((state, i) =>
      stateQuery(state)
        .split('&')
        .map((pair) => `${i + 1}.${pair}`)
        .join('&'),
    )
    .join('&');
}

/**
 * Сценарии из адреса. Понимает и прежний формат, где каждый сценарий был вложен
 * в параметр s целиком. Пустой массив — сценариев в адресе нет.
 */
export function decodeScenarios(
  params: URLSearchParams,
  max: number,
  fallback: CalculatorState = DEFAULT_STATE,
): CalculatorState[] {
  const byIndex = new Map<number, URLSearchParams>();
  for (const [key, value] of params) {
    const match = /^(\d+)\.(.+)$/.exec(key);
    if (!match) continue;
    const index = Number(match[1]);
    if (index < 1 || index > max) continue;
    const own = byIndex.get(index) ?? new URLSearchParams();
    own.append(match[2]!, value);
    byIndex.set(index, own);
  }
  if (byIndex.size > 0) {
    return [...byIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, own]) => decodeState(own, fallback));
  }
  return params
    .getAll('s')
    .slice(0, max)
    .map((s) => decodeState(new URLSearchParams(s), fallback));
}

/** Ссылка на текущий расчёт для кнопки «Скопировать ссылку» */
export function stateUrl(state: CalculatorState, base: string): string {
  const url = new URL(base);
  url.search = stateQuery(state);
  return url.toString();
}
