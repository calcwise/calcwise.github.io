/*
 * Отрисовка таблиц графика: общая для страницы калькулятора и страницы
 * «только график». Разметка таблиц — components/organisms/schedule-table.astro.
 */
import { clear, el, q, qa } from './dom.ts';
import { fmtInt, fmtMoney, fmtMonths, fmtMonthsAsYears, fmtRate, plural } from './format.ts';
import { yearSummaries } from './mortgage/index.ts';
import type { ScheduleResult } from './mortgage/index.ts';
import type { CalculatorState } from './url-state.ts';

/** Условия кредита одной строкой: для шапки результатов и печати */
export function describeState(state: CalculatorState, result?: ScheduleResult): string {
  const parts: string[] = [];
  parts.push(`сумма ${fmtMoney(state.amount)}`);
  const [first, ...rest] = state.rates;
  let rate = `ставка ${fmtRate(first!.ratePercent)}%`;
  if (rest.length)
    rate += ` (${rest.map((r) => `с ${r.fromMonth}-го мес. ${fmtRate(r.ratePercent)}%`).join(', ')})`;
  parts.push(rate);
  const total = result?.summary.plannedMonths ?? state.months;
  parts.push(
    total % 12 === 0
      ? `${total / 12} ${plural(total / 12, 'год', 'года', 'лет')}`
      : fmtMonths(total),
  );
  parts.push(state.type === 'annuity' ? 'аннуитетный' : 'дифференцированный');
  for (const g of state.gracePeriods ?? [])
    parts.push(`отсрочка ${fmtMonths(g.months)} с ${g.start}-го`);
  for (const p of state.prepayments ?? []) {
    const when =
      p.repeat === 'once'
        ? `в ${p.month}-м мес.`
        : p.repeat === 'monthly'
          ? `ежемесячно с ${p.month}-го`
          : `ежегодно с ${p.month}-го`;
    parts.push(
      `досрочно ${fmtMoney(p.amount)} ${when}, ${p.mode === 'term' ? 'срок короче' : 'платёж меньше'}`,
    );
  }
  return parts.join(' · ');
}

export function renderScheduleTable(root: HTMLElement, r: ScheduleResult): void {
  const body = q(root, '[data-out="schedule-body"]');
  const hasPrepay = r.summary.totalPrepaid > 0;
  const hasRates = r.input.rates.length > 1;
  qa(root, '[data-col="prepayment"]').forEach((c) => (c.hidden = !hasPrepay));
  qa(root, '[data-col="rate"]').forEach((c) => (c.hidden = !hasRates));
  const frag = document.createDocumentFragment();
  for (const row of r.rows) {
    const classes = ['schedule__row'];
    if (row.isGrace) classes.push('schedule__row--grace');
    if (row.month % 12 === 0) classes.push('schedule__row--year-end');
    frag.append(
      el('tr', { class: classes.join(' ') }, [
        el('th', { scope: 'row', class: 'num' }, [
          String(row.month),
          row.isGrace ? el('span', { class: 'schedule__tag', text: 'отсрочка' }) : null,
        ]),
        el('td', {
          class: 'num',
          text: fmtRate(row.ratePercent),
          'data-col': 'rate',
          hidden: !hasRates,
        }),
        el('td', { class: 'num', text: fmtMoney(row.payment) }),
        el('td', { class: 'num cell--principal', text: fmtMoney(row.principal) }),
        el('td', { class: 'num cell--interest', text: fmtMoney(row.interest) }),
        el('td', {
          class: 'num cell--prepay',
          text: row.prepayment ? fmtMoney(row.prepayment) : '',
          'data-col': 'prepayment',
          hidden: !hasPrepay,
        }),
        el('td', { class: 'num', text: fmtMoney(row.balance) }),
        el('td', { class: 'num', text: fmtMoney(row.paidTotal) }),
        el('td', { class: 'num', text: fmtMoney(row.paidInterest) }),
        el('td', { class: 'num', text: fmtMoney(row.remainingTotal) }),
      ]),
    );
  }
  body.replaceChildren(frag);
  q(root, '[data-out="foot-paid"]').textContent = fmtMoney(r.summary.totalPaid);
  q(root, '[data-out="foot-principal"]').textContent = fmtMoney(r.summary.totalPrincipal);
  q(root, '[data-out="foot-interest"]').textContent = fmtMoney(r.summary.totalInterest);
  q(root, '[data-out="foot-prepay"]').textContent = hasPrepay
    ? fmtMoney(r.summary.totalPrepaid)
    : '';
  const count = root.querySelector('[data-out="rows-count"]');
  if (count)
    count.textContent = `${fmtInt(r.rows.length)} ${plural(r.rows.length, 'платёж', 'платежа', 'платежей')}`;
}

export function renderYearsTable(root: HTMLElement, r: ScheduleResult): void {
  const body = q(root, '[data-out="years-body"]');
  clear(body);
  for (const y of yearSummaries(r)) {
    body.append(
      el('tr', {}, [
        el('th', { scope: 'row', text: `${y.year}-й` }),
        el('td', { class: 'num', text: fmtMoney(y.paid) }),
        el('td', { class: 'num cell--principal', text: fmtMoney(y.principal) }),
        el('td', { class: 'num cell--interest', text: fmtMoney(y.interest) }),
        el('td', { class: 'num', text: fmtMoney(y.balance) }),
      ]),
    );
  }
}

/** Ключевые цифры одной строкой: платёж, всего, переплата, срок */
export function keyStats(r: ScheduleResult): Array<{
  label: string;
  value: string;
  note?: string;
  tone?: 'principal' | 'interest' | 'prepay';
}> {
  const s = r.summary;
  const stats: ReturnType<typeof keyStats> = [
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
