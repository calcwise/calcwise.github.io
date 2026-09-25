/*
 * Отрисовка результатов: строки таблиц, ключевые цифры, сводка. Всё — HTML-строки,
 * одинаковые для сборки (Astro вставляет их через set:html для стартового
 * состояния, чтобы страница не прыгала при загрузке) и для браузера (innerHTML
 * при пересчёте). В строки попадают только числа и заранее известные подписи.
 */
import {
  fmtInt,
  fmtMoney,
  fmtMonths,
  fmtMonthsAsYears,
  fmtRate,
  formatAmountInput,
  plural,
} from './format.ts';
import { maxPlannedPayment, prepaymentEffect, yearSummaries } from './mortgage/index.ts';
import type { PrepaymentEffect, ScheduleResult, SensitivityCell } from './mortgage/index.ts';
import type { CalculatorState } from './url-state.ts';

const escape = (s: string) =>
  s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/** Условия кредита одной фразой: для шапки результатов и печати */
export function describeState(state: CalculatorState, result?: ScheduleResult): string {
  const [first, ...rest] = state.rates;
  const total = result?.summary.plannedMonths ?? state.months;
  const term =
    total % 12 === 0
      ? `${total / 12} ${plural(total / 12, 'год', 'года', 'лет')}`
      : fmtMonths(total);
  const type =
    state.type === 'annuity' ? 'аннуитетными платежами' : 'дифференцированными платежами';

  let text = `${fmtMoney(state.amount)} под ${fmtRate(first!.ratePercent)}% на ${term} ${type}`;
  if (state.targetPayment !== undefined)
    text += `, срок подобран под платёж не больше ${fmtMoney(state.targetPayment)}`;
  if (rest.length) {
    text += `, ставка меняется: ${rest
      .map((r) => `с ${r.fromMonth}-го месяца ${fmtRate(r.ratePercent)}%`)
      .join(', ')}`;
  }
  for (const g of state.gracePeriods ?? []) {
    text += `, отсрочка по долгу ${fmtMonths(g.months)} с ${g.start}-го`;
  }
  for (const p of state.prepayments ?? []) {
    const when =
      p.repeat === 'once'
        ? `в ${p.month}-м месяце`
        : p.repeat === 'monthly'
          ? `ежемесячно с ${p.month}-го`
          : `ежегодно с ${p.month}-го`;
    const mode = p.mode === 'term' ? 'с сокращением срока' : 'с уменьшением платежа';
    text +=
      p.kind === 'budget'
        ? `, плачу всего ${fmtMoney(p.amount)} ${when} ${mode}`
        : `, досрочно ${fmtMoney(p.amount)} ${when} ${mode}`;
  }
  if (state.interestInArrears) text += ', проценты за предыдущий месяц';
  const extra = extraOverpayment(state);
  if (extra > 0) text += `, дополнительная переплата ${fmtMoney(extra)}`;
  return `${text}.`;
}

/**
 * Дополнительная переплата сверх графика: то, что банк добавляет к итогу (комиссия,
 * страховка, лишний платёж в распечатке). Учитывается, только если пользователь её ввёл.
 */
export function extraOverpayment(state: CalculatorState): number {
  return state.extraOverpayment === undefined ? 0 : Math.max(0, state.extraOverpayment);
}

/** Подсказка для пустого поля: один платёж — у аннуитета ежемесячный, у дифференцированного первый по процентам */
export function suggestedExtra(state: CalculatorState, result: ScheduleResult): number {
  return state.type === 'annuity' ? result.summary.regularPayment : (result.rows[0]?.interest ?? 0);
}

const plusExtra = (value: number, extra: number): number => Math.round((value + extra) * 100) / 100;

/** Значения главных полей формы: одни и те же при сборке и после загрузки скрипта */
export interface FormValues {
  amount: string;
  rate: string;
  term: string;
  unit: 'years' | 'months';
  payment: string;
  paymentLabel: string;
}

export function formValues(state: CalculatorState, result: ScheduleResult | null): FormValues {
  const byPayment = state.targetPayment !== undefined;
  /* Срок не в целых годах показываем месяцами, если его ввёл человек; если его подобрали
     под платёж, уважаем выбранные годы и показываем дробью */
  const unit = state.termInYears && (byPayment || state.months % 12 === 0) ? 'years' : 'months';
  return {
    amount: formatAmountInput(String(state.amount)),
    rate: fmtRate(state.rates[0]!.ratePercent),
    term:
      unit === 'years'
        ? String(Math.round((state.months / 12) * 100) / 100).replace('.', ',')
        : String(state.months),
    unit,
    payment: byPayment
      ? formatAmountInput(String(state.targetPayment))
      : result
        ? formatAmountInput(maxPlannedPayment(result).toFixed(2))
        : '',
    paymentLabel: state.type === 'diff' ? 'Первый платёж' : 'Платёж в месяц',
  };
}

/** Подсказка у «Дополнительных условий» по умолчанию, пока ничего не задано */
export const EXTRA_HINT_EMPTY =
  'ставка по периодам, отсрочка, досрочные погашения, порядок процентов, переплата';

/** Заданы ли дополнительные условия: тогда блок с ними раскрыт */
export function hasExtraConditions(state: CalculatorState): boolean {
  return (
    state.rates.length > 1 ||
    (state.gracePeriods?.length ?? 0) > 0 ||
    (state.prepayments?.length ?? 0) > 0 ||
    Boolean(state.interestInArrears) ||
    state.extraOverpayment !== undefined
  );
}

/** Подсказка у «Дополнительных условий»: что уже задано, одной строкой */
export function extraHintText(state: CalculatorState): string {
  const extras: string[] = [];
  const periods = state.rates.length - 1;
  if (periods > 0) extras.push(`${periods} ${periods === 1 ? 'период ставки' : 'периода ставки'}`);
  if (state.gracePeriods?.length)
    extras.push(`отсрочка ${state.gracePeriods.reduce((a, g) => a + g.months, 0)} мес.`);
  const prepays = state.prepayments?.length ?? 0;
  if (prepays)
    extras.push(
      `${prepays} ${plural(prepays, 'досрочное погашение', 'досрочных погашения', 'досрочных погашений')}`,
    );
  if (state.interestInArrears) extras.push('проценты за предыдущий месяц');
  if (state.extraOverpayment !== undefined)
    extras.push(`переплата ${fmtMoney(state.extraOverpayment)}`);
  return extras.length ? extras.join(', ') : EXTRA_HINT_EMPTY;
}

/** Блок «Эффект досрочных погашений»: одинаковый при сборке и в браузере */
export function effectHtml(r: ScheduleResult, effect: PrepaymentEffect | null): string {
  if (!effect) return '';
  return (
    '<h2 class="results__heading">Эффект досрочных погашений</h2>' +
    `<dl class="stats">${statsHtml([
      {
        label: 'Экономия на процентах',
        value: fmtMoney(effect.interestSaved),
        note: `без досрочек переплата ${fmtMoney(effect.baseline.summary.totalInterest)}`,
        tone: 'interest',
      },
      effect.monthsSaved > 0
        ? {
            label: 'Кредит закрыт раньше',
            value: `на ${fmtMonthsAsYears(effect.monthsSaved)}`,
            note: `за ${fmtMonthsAsYears(r.summary.actualMonths)} вместо ${fmtMonthsAsYears(effect.baseline.summary.actualMonths)}`,
          }
        : null,
      effect.paymentReduced > 0
        ? { label: 'Платёж снижен', value: `на ${fmtMoney(effect.paymentReduced)}` }
        : null,
    ])}</dl>`
  );
}

/** Главная цифра и подпись к ней */
export function figureText(r: ScheduleResult): { label: string; value: string; note: string } {
  const grace = r.rows.find((row) => row.isGrace);
  const firstRegular = r.rows.find((row) => !row.isGrace) ?? r.rows[0]!;
  const lastRegular =
    [...r.rows].reverse().find((row) => !row.isGrace) ?? r.rows[r.rows.length - 1]!;
  const ratePeriods = r.input.rates
    .slice(1)
    .map((period) => r.rows.find((row) => row.month >= period.fromMonth && !row.isGrace))
    .filter((row): row is NonNullable<typeof row> => row !== undefined);
  const reducing = r.input.prepayments.some((p) => p.mode === 'payment');
  const notes: string[] = [];
  let label: string;
  if (r.input.type === 'annuity') {
    label = ratePeriods.length
      ? 'Платёж в первый период'
      : reducing
        ? 'Платёж до досрочного погашения'
        : 'Ежемесячный платёж';
    if (grace) notes.push(`в отсрочку ${fmtMoney(grace.payment)}`);
    for (const row of ratePeriods)
      notes.push(
        `с ${row.month}-го месяца ${fmtMoney(row.payment)} при ставке ${fmtRate(row.ratePercent)}%`,
      );
    if (reducing) notes.push(`после досрочки ${fmtMoney(lastRegular.payment)}`);
  } else {
    label = 'Первый платёж';
    notes.push(`последний ${fmtMoney(lastRegular.payment)}`);
    if (grace) notes.push(`в отсрочку от ${fmtMoney(grace.payment)}`);
  }
  return { label, value: fmtMoney(firstRegular.payment), note: notes.join(', ') };
}

export interface Stat {
  label: string;
  value: string;
  note?: string;
  tone?: 'principal' | 'interest' | 'prepay';
}

/** Ключевые цифры: всего, срок, переплата, отсрочка, досрочно, введённая доплата */
export function keyStats(r: ScheduleResult, extra = 0): Stat[] {
  const s = r.summary;
  const stats: Stat[] = [
    {
      label: 'Всего выплачено',
      value: fmtMoney(plusExtra(s.totalPaid, extra)),
      note: extra > 0 ? 'с дополнительной переплатой' : undefined,
    },
    {
      label: 'Срок',
      value: fmtMonthsAsYears(s.actualMonths),
      note:
        s.actualMonths < s.plannedMonths
          ? `вместо ${fmtMonthsAsYears(s.plannedMonths)} по плану`
          : fmtMonths(s.actualMonths),
    },
    {
      label: 'Переплата по процентам',
      value: fmtMoney(s.totalInterest),
      note: `${fmtRate(s.overpaymentPercent)}% от суммы`,
      tone: 'interest',
    },
  ];
  if (s.graceMonths > 0)
    stats.push({
      label: 'Проценты за отсрочку',
      value: fmtMoney(s.graceInterest),
      note: fmtMonths(s.graceMonths),
    });
  if (s.totalPrepaid > 0)
    stats.push({ label: 'Досрочно внесено', value: fmtMoney(s.totalPrepaid), tone: 'prepay' });
  if (extra > 0)
    stats.push({ label: 'Дополнительная переплата', value: fmtMoney(extra), tone: 'interest' });
  return stats;
}

export function statsHtml(stats: Array<Stat | null>): string {
  return stats
    .filter((s): s is Stat => s !== null)
    .map(
      (s) =>
        `<div class="stat${s.tone ? ` stat--${s.tone}` : ''}">` +
        `<dt class="stat__label">${escape(s.label)}</dt>` +
        `<dd class="stat__value num">${escape(s.value)}</dd>` +
        (s.note ? `<dd class="stat__note">${escape(s.note)}</dd>` : '') +
        `</div>`,
    )
    .join('');
}

/**
 * Строка после последнего платежа, если кредит закрыт раньше плана:
 * пользователю важно увидеть, что дальше платить не нужно и что это дало.
 */
export function closingRowHtml(r: ScheduleResult): string {
  const s = r.summary;
  if (s.actualMonths >= s.plannedMonths) return '';
  const effect = prepaymentEffect(r);
  const parts = [
    `Кредит закрыт в ${s.actualMonths}-м месяце, дальше платить не нужно`,
    `на ${fmtMonthsAsYears(s.plannedMonths - s.actualMonths)} раньше плана`,
  ];
  if (effect) {
    parts.push(`досрочно внесено ${fmtMoney(s.totalPrepaid)}`);
    parts.push(`сэкономлено на процентах ${fmtMoney(effect.interestSaved)}`);
  }
  return (
    `<tr class="schedule__row schedule__row--closed"><td colspan="10">` +
    `<strong>${escape(parts[0]!)}</strong>: ${escape(parts.slice(1).join(', '))}.` +
    `</td></tr>`
  );
}

/** Нулевая строка графика: введённая дополнительная переплата до первого платежа */
function extraRowHtml(r: ScheduleResult, extra: number, hidden: (show: boolean) => string): string {
  if (extra <= 0) return '';
  const hasPrepay = r.summary.totalPrepaid > 0;
  const hasRates = r.input.rates.length > 1;
  return (
    `<tr class="schedule__row schedule__row--extra">` +
    `<th scope="row" class="num">0<span class="schedule__tag">доплата</span></th>` +
    `<td class="num" data-col="rate"${hidden(hasRates)}></td>` +
    `<td class="num">${fmtMoney(extra)}</td>` +
    `<td class="num cell--principal">${fmtMoney(0)}</td>` +
    `<td class="num cell--interest">${fmtMoney(0)}</td>` +
    `<td class="num cell--prepay" data-col="prepayment"${hidden(hasPrepay)}></td>` +
    `<td class="num">${fmtMoney(r.summary.amount)}</td>` +
    `<td class="num">${fmtMoney(extra)}</td>` +
    `<td class="num">${fmtMoney(0)}</td>` +
    `<td class="num">${fmtMoney(r.summary.totalPaid)}</td>` +
    `</tr>`
  );
}

/** Строки графика. «Платёж» — всё, что уходит в этом месяце: плановый платёж вместе с досрочкой */
export function scheduleRowsHtml(r: ScheduleResult, extra = 0): string {
  const hasPrepay = r.summary.totalPrepaid > 0;
  const hasRates = r.input.rates.length > 1;
  const hidden = (show: boolean) => (show ? '' : ' hidden');
  const closing = closingRowHtml(r);
  const first = extraRowHtml(r, extra, hidden);
  return r.rows
    .map((row) => {
      const classes = ['schedule__row'];
      if (row.isGrace) classes.push('schedule__row--grace');
      if (row.month % 12 === 0) classes.push('schedule__row--year-end');
      return (
        `<tr class="${classes.join(' ')}">` +
        `<th scope="row" class="num">${row.month}${row.isGrace ? '<span class="schedule__tag">отсрочка</span>' : ''}</th>` +
        `<td class="num" data-col="rate"${hidden(hasRates)}>${fmtRate(row.ratePercent)}</td>` +
        `<td class="num">${fmtMoney(row.total)}</td>` +
        `<td class="num cell--principal">${fmtMoney(row.principal)}</td>` +
        `<td class="num cell--interest">${fmtMoney(row.interest)}</td>` +
        `<td class="num cell--prepay" data-col="prepayment"${hidden(hasPrepay)}>${row.prepayment ? fmtMoney(row.prepayment) : ''}</td>` +
        `<td class="num">${fmtMoney(row.balance)}</td>` +
        `<td class="num">${fmtMoney(plusExtra(row.paidTotal, extra))}</td>` +
        `<td class="num">${fmtMoney(row.paidInterest)}</td>` +
        `<td class="num">${fmtMoney(row.remainingTotal)}</td>` +
        `</tr>`
      );
    })
    .join('')
    .concat(closing)
    .replace(/^/, first);
}

export function yearsRowsHtml(r: ScheduleResult): string {
  return yearSummaries(r)
    .map(
      (y) =>
        `<tr><th scope="row">${y.year}-й</th>` +
        `<td class="num">${fmtMoney(y.paid)}</td>` +
        `<td class="num cell--principal">${fmtMoney(y.principal)}</td>` +
        `<td class="num cell--interest">${fmtMoney(y.interest)}</td>` +
        `<td class="num">${fmtMoney(y.balance)}</td></tr>`,
    )
    .join('');
}

export function sensitivityHtml(cells: SensitivityCell[], head: string): string {
  const rows = cells
    .map(
      (c) =>
        `<tr${c.isCurrent ? ' class="mini-table__current"' : ''}>` +
        `<th scope="row">${escape(c.label)}</th>` +
        `<td>${fmtMoney(c.payment)}</td><td>${fmtMoney(c.totalInterest)}</td></tr>`,
    )
    .join('');
  return (
    `<table class="mini-table num"><thead><tr>` +
    `<th scope="col">${escape(head)}</th><th scope="col">Платёж</th><th scope="col">Переплата</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>`
  );
}

export function rowsCountText(r: ScheduleResult): string {
  return `${fmtInt(r.rows.length)} ${plural(r.rows.length, 'платёж', 'платежа', 'платежей')}`;
}

export function shareText(r: ScheduleResult): {
  principal: number;
  labelPrincipal: string;
  labelInterest: string;
} {
  const principal = (r.summary.totalPrincipal / r.summary.totalPaid) * 100;
  return {
    principal,
    labelPrincipal: `Основной долг ${fmtRate(Math.round(principal * 10) / 10)}%`,
    labelInterest: `Проценты ${fmtRate(Math.round((100 - principal) * 10) / 10)}%`,
  };
}

/* ------------------------------------------------------------------ */
/* Применение к DOM (браузер)                                          */
/* ------------------------------------------------------------------ */

const byOut = (root: ParentNode, key: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-out="${key}"]`);

export function renderScheduleTable(root: HTMLElement, r: ScheduleResult, extra = 0): void {
  const hasPrepay = r.summary.totalPrepaid > 0;
  const hasRates = r.input.rates.length > 1;
  root
    .querySelectorAll<HTMLElement>('[data-col="prepayment"]')
    .forEach((c) => (c.hidden = !hasPrepay));
  root.querySelectorAll<HTMLElement>('[data-col="rate"]').forEach((c) => (c.hidden = !hasRates));
  const body = byOut(root, 'schedule-body');
  if (body) body.innerHTML = scheduleRowsHtml(r, extra);
  const set = (key: string, text: string) => {
    const node = byOut(root, key);
    if (node) node.textContent = text;
  };
  set('foot-paid', fmtMoney(plusExtra(r.summary.totalPaid, extra)));
  set('foot-principal', fmtMoney(r.summary.totalPrincipal));
  set('foot-interest', fmtMoney(r.summary.totalInterest));
  set('foot-prepay', hasPrepay ? fmtMoney(r.summary.totalPrepaid) : '');
  set('rows-count', rowsCountText(r));
}

export function renderYearsTable(root: HTMLElement, r: ScheduleResult): void {
  const body = byOut(root, 'years-body');
  if (body) body.innerHTML = yearsRowsHtml(r);
}

export function renderKeyFigures(
  root: HTMLElement,
  state: CalculatorState,
  r: ScheduleResult,
): void {
  const figure = figureText(r);
  const set = (key: string, text: string) => {
    const node = byOut(root, key);
    if (node) node.textContent = text;
  };
  set('conditions', describeState(state, r));
  set('figure', figure.value);
  set('figure-label', figure.label);
  set('figure-note', figure.note);
  const stats = byOut(root, 'stats');
  if (stats) stats.innerHTML = statsHtml(keyStats(r, extraOverpayment(state)));
  const share = shareText(r);
  const bar = byOut(root, 'share');
  if (bar) {
    bar.querySelector<HTMLElement>('.share__principal')!.style.width = `${share.principal}%`;
    bar.querySelector<HTMLElement>('.share__interest')!.style.width = `${100 - share.principal}%`;
  }
  set('share-principal', share.labelPrincipal);
  set('share-interest', share.labelInterest);
}
