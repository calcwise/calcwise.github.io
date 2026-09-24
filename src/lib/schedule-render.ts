/*
 * Отрисовка результатов: строки таблиц, ключевые цифры, сводка. Всё — HTML-строки,
 * одинаковые для сборки (Astro вставляет их через set:html для стартового
 * состояния, чтобы страница не прыгала при загрузке) и для браузера (innerHTML
 * при пересчёте). В строки попадают только числа и заранее известные подписи.
 */
import { fmtInt, fmtMoney, fmtMonths, fmtMonthsAsYears, fmtRate, plural } from './format.ts';
import { yearSummaries } from './mortgage/index.ts';
import type { ScheduleResult, SensitivityCell } from './mortgage/index.ts';
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
    text += `, досрочно ${fmtMoney(p.amount)} ${when} ${mode}`;
  }
  return `${text}.`;
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

/** Ключевые цифры: всего, переплата, срок, отсрочка, досрочно */
export function keyStats(r: ScheduleResult): Stat[] {
  const s = r.summary;
  const stats: Stat[] = [
    { label: 'Всего выплачено', value: fmtMoney(s.totalPaid) },
    {
      label: 'Переплата по процентам',
      value: fmtMoney(s.totalInterest),
      note: `${fmtRate(s.overpaymentPercent)}% от суммы`,
      tone: 'interest',
    },
    {
      label: 'Срок',
      value: fmtMonthsAsYears(s.actualMonths),
      note:
        s.actualMonths < s.plannedMonths
          ? `вместо ${fmtMonthsAsYears(s.plannedMonths)} по плану`
          : fmtMonths(s.actualMonths),
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

export function scheduleRowsHtml(r: ScheduleResult): string {
  const hasPrepay = r.summary.totalPrepaid > 0;
  const hasRates = r.input.rates.length > 1;
  const hidden = (show: boolean) => (show ? '' : ' hidden');
  return r.rows
    .map((row) => {
      const classes = ['schedule__row'];
      if (row.isGrace) classes.push('schedule__row--grace');
      if (row.month % 12 === 0) classes.push('schedule__row--year-end');
      return (
        `<tr class="${classes.join(' ')}">` +
        `<th scope="row" class="num">${row.month}${row.isGrace ? '<span class="schedule__tag">отсрочка</span>' : ''}</th>` +
        `<td class="num" data-col="rate"${hidden(hasRates)}>${fmtRate(row.ratePercent)}</td>` +
        `<td class="num">${fmtMoney(row.payment)}</td>` +
        `<td class="num cell--principal">${fmtMoney(row.principal)}</td>` +
        `<td class="num cell--interest">${fmtMoney(row.interest)}</td>` +
        `<td class="num cell--prepay" data-col="prepayment"${hidden(hasPrepay)}>${row.prepayment ? fmtMoney(row.prepayment) : ''}</td>` +
        `<td class="num">${fmtMoney(row.balance)}</td>` +
        `<td class="num">${fmtMoney(row.paidTotal)}</td>` +
        `<td class="num">${fmtMoney(row.paidInterest)}</td>` +
        `<td class="num">${fmtMoney(row.remainingTotal)}</td>` +
        `</tr>`
      );
    })
    .join('');
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
    labelPrincipal: `Основной долг ${principal.toFixed(1)}%`,
    labelInterest: `Проценты ${(100 - principal).toFixed(1)}%`,
  };
}

/* ------------------------------------------------------------------ */
/* Применение к DOM (браузер)                                          */
/* ------------------------------------------------------------------ */

const byOut = (root: ParentNode, key: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-out="${key}"]`);

export function renderScheduleTable(root: HTMLElement, r: ScheduleResult): void {
  const hasPrepay = r.summary.totalPrepaid > 0;
  const hasRates = r.input.rates.length > 1;
  root
    .querySelectorAll<HTMLElement>('[data-col="prepayment"]')
    .forEach((c) => (c.hidden = !hasPrepay));
  root.querySelectorAll<HTMLElement>('[data-col="rate"]').forEach((c) => (c.hidden = !hasRates));
  const body = byOut(root, 'schedule-body');
  if (body) body.innerHTML = scheduleRowsHtml(r);
  const set = (key: string, text: string) => {
    const node = byOut(root, key);
    if (node) node.textContent = text;
  };
  set('foot-paid', fmtMoney(r.summary.totalPaid));
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
  if (stats) stats.innerHTML = statsHtml(keyStats(r));
  const share = shareText(r);
  const bar = byOut(root, 'share');
  if (bar) {
    bar.querySelector<HTMLElement>('.share__principal')!.style.width = `${share.principal}%`;
    bar.querySelector<HTMLElement>('.share__interest')!.style.width = `${100 - share.principal}%`;
  }
  set('share-principal', share.labelPrincipal);
  set('share-interest', share.labelInterest);
}
