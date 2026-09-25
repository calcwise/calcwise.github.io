/*
 * Интерактивность страницы калькулятора. Разметка — в
 * components/organisms/mortgage-calculator.astro, здесь только поведение:
 * чтение формы → расчёт → отрисовка результатов → адрес страницы.
 */
import { balanceChart, yearsChart } from './charts.ts';
import { downloadText, scheduleToCsv } from './csv.ts';
import { clear, debounce, el, q, qa } from './dom.ts';
import { guardNumericInputs } from './numeric-input.ts';
import {
  fmtMoney,
  fmtMonthsAsYears,
  fmtRate,
  formatAmountInput,
  parseInteger,
  parseNumber,
} from './format.ts';
import {
  ScheduleInputError,
  buildSchedule,
  maxPlannedPayment,
  termForPayment,
  extraPaymentForTerm,
  plannedMonths,
  prepaymentEffect,
  rateSensitivity,
  termSensitivity,
  yearSummaries,
} from './mortgage/index.ts';
import type { GracePeriod, Prepayment, RatePeriod, ScheduleResult } from './mortgage/index.ts';
import {
  extraOverpayment,
  renderKeyFigures,
  suggestedExtra,
  renderScheduleTable,
  renderYearsTable,
  sensitivityHtml,
  statsHtml,
} from './schedule-render.ts';
import {
  DEFAULT_STATE,
  decodeState,
  encodeState,
  scenariosQuery,
  stateQuery,
} from './url-state.ts';
import type { CalculatorState } from './url-state.ts';

const STORAGE_KEY = 'calcwise:mortgage:v3';
let uid = 0;

/* ------------------------------------------------------------------ */
/* Элементы формы                                                      */
/* ------------------------------------------------------------------ */

interface FormRefs {
  root: HTMLElement;
  form: HTMLFormElement;
  amount: HTMLInputElement;
  rate: HTMLInputElement;
  term: HTMLInputElement;
  termUnit: () => 'years' | 'months' | 'payment';
  termUnits: HTMLElement;
  type: () => 'annuity' | 'diff';
  rates: HTMLElement;
  grace: HTMLElement;
  graceExtends: HTMLInputElement;
  interestArrears: HTMLInputElement;
  extraOverpayment: HTMLInputElement;
  prepayments: HTMLElement;
  extra: HTMLDetailsElement;
  errors: HTMLElement;
}

/* В режиме платежа единицы срока не нужны, а поле называется по-другому для читалок */
function syncTermMode(refs: FormRefs): void {
  const byPayment = refs.termUnit() === 'payment';
  refs.termUnits.hidden = byPayment;
  refs.term.setAttribute('aria-label', byPayment ? 'Платёж в месяц' : 'Срок');
}

interface FieldError {
  field: string;
  message: string;
}

const numberInput = (attrs: Record<string, string | number | boolean | undefined>) =>
  el('input', { class: 'control__input num', inputmode: 'decimal', autocomplete: 'off', ...attrs });

function labelled(label: string, input: HTMLElement, unit?: string, className = ''): HTMLElement {
  return el('label', { class: `control${className ? ` ${className}` : ''}` }, [
    el('span', { class: 'control__label', text: label }),
    el('span', { class: 'control__field' }, [
      input,
      unit ? el('span', { class: 'control__unit', text: unit }) : null,
    ]),
  ]);
}

/** Сегментный переключатель вместо нативного select */
function segmented(
  label: string,
  key: string,
  options: Array<[string, string]>,
  value: string,
  className = '',
): HTMLElement {
  const name = `seg-${key}-${++uid}`;
  return el('div', { class: `control${className ? ` ${className}` : ''}` }, [
    el('span', { class: 'control__label', text: label }),
    el(
      'div',
      { class: 'segmented', role: 'radiogroup', 'aria-label': label, 'data-key': key },
      options.map(([val, text]) =>
        el('label', { class: 'segmented__option' }, [
          el('input', { type: 'radio', name, value: val, checked: val === value }),
          el('span', { text }),
        ]),
      ),
    ),
  ]);
}

const segValue = (row: Element, key: string): string =>
  row.querySelector<HTMLInputElement>(`[data-key="${key}"] input:checked`)?.value ?? '';

function removeButton(onclick: () => void, label: string): HTMLElement {
  return el(
    'button',
    { type: 'button', class: 'row__remove', 'aria-label': label, title: label, onclick },
    [el('span', { 'aria-hidden': 'true', text: '×' })],
  );
}

function renderRateRow(list: HTMLElement, rate: RatePeriod, onChange: () => void): void {
  const row = el('div', { class: 'row row--rate', 'data-row': 'rate' }, [
    labelled(
      'С месяца',
      numberInput({ inputmode: 'numeric', value: String(rate.fromMonth), 'data-key': 'fromMonth' }),
      '№',
      'row__a',
    ),
    labelled(
      'Ставка',
      numberInput({ value: fmtRate(rate.ratePercent), 'data-key': 'ratePercent' }),
      '%',
      'row__b',
    ),
    removeButton(() => {
      row.remove();
      onChange();
    }, 'Удалить период ставки'),
  ]);
  list.append(row);
}

function renderGraceRow(list: HTMLElement, grace: GracePeriod, onChange: () => void): void {
  const row = el('div', { class: 'row row--grace', 'data-row': 'grace' }, [
    labelled(
      'С месяца',
      numberInput({ inputmode: 'numeric', value: String(grace.start), 'data-key': 'start' }),
      '№',
      'row__a',
    ),
    labelled(
      'Месяцев',
      numberInput({ inputmode: 'numeric', value: String(grace.months), 'data-key': 'months' }),
      undefined,
      'row__b',
    ),
    removeButton(() => {
      row.remove();
      onChange();
    }, 'Удалить отсрочку'),
  ]);
  list.append(row);
}

function renderPrepaymentRow(list: HTMLElement, p: Prepayment, onChange: () => void): void {
  const until = labelled(
    'До месяца',
    numberInput({
      inputmode: 'numeric',
      value: p.untilMonth ? String(p.untilMonth) : '',
      'data-key': 'untilMonth',
      placeholder: 'конец',
    }),
    '№',
    'row__until',
  );
  const repeat = segmented(
    'Повтор',
    'repeat',
    [
      ['once', 'Разово'],
      ['monthly', 'Ежемесячно'],
      ['yearly', 'Ежегодно'],
    ],
    p.repeat,
    'row__repeat',
  );
  const monthLabel = el('span', {
    class: 'control__label',
    text: p.repeat === 'once' ? 'В месяце' : 'С месяца',
  });
  const month = el('label', { class: 'control row__month' }, [
    monthLabel,
    el('span', { class: 'control__field' }, [
      numberInput({ inputmode: 'numeric', value: String(p.month), 'data-key': 'month' }),
      el('span', { class: 'control__unit', text: '№' }),
    ]),
  ]);
  const amountLabel = el('span', {
    class: 'control__label',
    text: p.kind === 'budget' ? 'Плачу в месяц' : 'Сумма сверх платежа',
  });
  const amount = el('label', { class: 'control row__amount' }, [
    amountLabel,
    el('span', { class: 'control__field' }, [
      numberInput({ value: formatAmountInput(String(p.amount)), 'data-key': 'amount' }),
    ]),
  ]);
  const kind = segmented(
    'Как считать',
    'kind',
    [
      ['extra', 'Сверх платежа'],
      ['budget', 'Всего в месяц'],
    ],
    p.kind ?? 'extra',
    'row__kind',
  );
  const row = el('div', { class: 'row row--prepay', 'data-row': 'prepayment' }, [
    kind,
    amount,
    month,
    segmented(
      'Что пересчитать',
      'mode',
      [
        ['term', 'Срок'],
        ['payment', 'Платёж'],
      ],
      p.mode,
      'row__mode',
    ),
    repeat,
    until,
    removeButton(() => {
      row.remove();
      onChange();
    }, 'Удалить досрочное погашение'),
  ]);
  const sync = () => {
    const once = segValue(row, 'repeat') === 'once';
    until.classList.toggle('control--hidden', once);
    monthLabel.textContent = once ? 'В месяце' : 'С месяца';
    amountLabel.textContent =
      segValue(row, 'kind') === 'budget' ? 'Плачу в месяц' : 'Сумма сверх платежа';
  };
  repeat.addEventListener('change', sync);
  kind.addEventListener('change', sync);
  sync();
  list.append(row);
}

function fillForm(refs: FormRefs, state: CalculatorState, onChange: () => void): void {
  refs.amount.value = formatAmountInput(String(state.amount));
  refs.rate.value = fmtRate(state.rates[0]!.ratePercent);
  const wholeYears = state.months % 12 === 0;
  const inYears = state.termInYears && wholeYears;
  const byPayment = state.targetPayment !== undefined;
  const unit = inYears ? 'years' : 'months';
  const mode = byPayment ? 'payment' : 'term';
  q<HTMLInputElement>(refs.form, `input[name="term-unit"][value="${unit}"]`).checked = true;
  q<HTMLInputElement>(refs.form, `input[name="term-mode"][value="${mode}"]`).checked = true;
  refs.term.value = byPayment
    ? formatAmountInput(String(state.targetPayment))
    : inYears
      ? String(state.months / 12)
      : String(state.months);
  syncTermMode(refs);
  q<HTMLInputElement>(refs.form, `input[name="type"][value="${state.type}"]`).checked = true;

  clear(refs.rates);
  state.rates.slice(1).forEach((r) => renderRateRow(refs.rates, r, onChange));
  clear(refs.grace);
  (state.gracePeriods ?? []).forEach((g) => renderGraceRow(refs.grace, g, onChange));
  refs.graceExtends.checked = Boolean(state.graceExtendsTerm);
  refs.interestArrears.checked = Boolean(state.interestInArrears);
  refs.extraOverpayment.value =
    state.extraOverpayment === undefined ? '' : formatAmountInput(String(state.extraOverpayment));
  clear(refs.prepayments);
  (state.prepayments ?? []).forEach((p) => renderPrepaymentRow(refs.prepayments, p, onChange));

  const hasExtra =
    state.rates.length > 1 ||
    (state.gracePeriods?.length ?? 0) > 0 ||
    (state.prepayments?.length ?? 0) > 0 ||
    Boolean(state.interestInArrears) ||
    state.extraOverpayment !== undefined;
  if (hasExtra) refs.extra.open = true;
}

interface ReadResult {
  state: CalculatorState;
  errors: FieldError[];
}

function readForm(refs: FormRefs): ReadResult {
  const errors: FieldError[] = [];
  const amount = parseNumber(refs.amount.value);
  if (!Number.isFinite(amount) || amount <= 0)
    errors.push({ field: 'amount', message: 'Введите сумму больше 0' });

  const baseRate = parseNumber(refs.rate.value);
  if (!Number.isFinite(baseRate) || baseRate < 0)
    errors.push({ field: 'rate', message: 'Ставка — число от 0, например 15,4' });

  const unit = refs.termUnit();
  let months = Number.NaN;
  let targetPayment: number | undefined;
  if (unit === 'payment') {
    targetPayment = parseNumber(refs.term.value);
    if (!Number.isFinite(targetPayment) || targetPayment <= 0)
      errors.push({ field: 'term', message: 'Введите платёж в месяц больше 0' });
  } else if (unit === 'years') {
    const years = parseNumber(refs.term.value);
    months = Number.isFinite(years) ? Math.round(years * 12) : Number.NaN;
    if (!Number.isFinite(years) || years <= 0)
      errors.push({ field: 'term', message: 'Введите срок в годах, например 20 или 7,5' });
  } else {
    months = parseInteger(refs.term.value);
    if (!Number.isInteger(months) || months < 1)
      errors.push({ field: 'term', message: 'Срок — целое число месяцев от 1' });
  }
  if (Number.isFinite(months) && months > 600)
    errors.push({ field: 'term', message: 'Максимум 600 месяцев (50 лет)' });

  const rates: RatePeriod[] = [{ fromMonth: 1, ratePercent: baseRate }];
  qa(refs.rates, '[data-row="rate"]').forEach((row, i) => {
    const percent = parseNumber(q<HTMLInputElement>(row, '[data-key="ratePercent"]').value);
    const from = parseInteger(q<HTMLInputElement>(row, '[data-key="fromMonth"]').value);
    if (!Number.isFinite(percent) || percent < 0)
      errors.push({ field: `rates.${i + 1}`, message: 'Ставка периода — число от 0' });
    if (!Number.isInteger(from) || from < 2)
      errors.push({
        field: `rates.${i + 1}`,
        message: 'Период ставки начинается со 2-го месяца или позже',
      });
    rates.push({ ratePercent: percent, fromMonth: from });
  });

  const gracePeriods: GracePeriod[] = qa(refs.grace, '[data-row="grace"]').map((row, i) => {
    const start = parseInteger(q<HTMLInputElement>(row, '[data-key="start"]').value);
    const count = parseInteger(q<HTMLInputElement>(row, '[data-key="months"]').value);
    if (!Number.isInteger(start) || start < 1)
      errors.push({ field: `grace.${i}`, message: 'Месяц начала отсрочки — целое число от 1' });
    if (!Number.isInteger(count) || count < 1)
      errors.push({
        field: `grace.${i}`,
        message: 'Длительность отсрочки — целое число месяцев от 1',
      });
    return { start, months: count };
  });

  const prepayments: Prepayment[] = qa(refs.prepayments, '[data-row="prepayment"]').map(
    (row, i) => {
      const month = parseInteger(q<HTMLInputElement>(row, '[data-key="month"]').value);
      const sum = parseNumber(q<HTMLInputElement>(row, '[data-key="amount"]').value);
      const mode = (segValue(row, 'mode') || 'term') as Prepayment['mode'];
      const repeat = (segValue(row, 'repeat') || 'once') as Prepayment['repeat'];
      const kind = segValue(row, 'kind') === 'budget' ? 'budget' : 'extra';
      const untilRaw = q<HTMLInputElement>(row, '[data-key="untilMonth"]').value.trim();
      if (!Number.isInteger(month) || month < 1)
        errors.push({
          field: `prepayments.${i}`,
          message: 'Месяц досрочного погашения — целое число от 1',
        });
      if (!Number.isFinite(sum) || sum <= 0)
        errors.push({ field: `prepayments.${i}`, message: 'Сумма досрочного погашения больше 0' });
      const item: Prepayment = { month, amount: sum, mode, repeat };
      if (kind === 'budget') item.kind = kind;
      if (repeat !== 'once' && untilRaw !== '') {
        const untilMonth = parseInteger(untilRaw);
        if (!Number.isInteger(untilMonth) || untilMonth < month)
          errors.push({
            field: `prepayments.${i}`,
            message: 'Месяц окончания повторов не раньше месяца начала',
          });
        item.untilMonth = untilMonth;
      }
      return item;
    },
  );

  const extraRaw = refs.extraOverpayment.value.trim();
  let extraOverpayment: number | undefined;
  if (extraRaw !== '') {
    extraOverpayment = parseNumber(extraRaw);
    if (!Number.isFinite(extraOverpayment) || extraOverpayment < 0) {
      errors.push({ field: 'extra-overpayment', message: 'Дополнительная переплата — число от 0' });
    }
  }

  const state: CalculatorState = {
    amount,
    months,
    type: refs.type(),
    rates,
    gracePeriods,
    graceExtendsTerm: refs.graceExtends.checked,
    interestInArrears: refs.interestArrears.checked,
    prepayments,
    termInYears: unit !== 'months',
  };
  if (extraOverpayment !== undefined) state.extraOverpayment = extraOverpayment;

  /* Расчёт по платежу: срок подбирается, когда остальные условия уже прочитаны без ошибок */
  if (targetPayment !== undefined && errors.length === 0) {
    state.targetPayment = targetPayment;
    const found = termForPayment(state, targetPayment);
    if (found === null) {
      /* Проценты за месяц на всю сумму по самой высокой ставке: меньше них платить нельзя */
      const interest = (amount * Math.max(...rates.map((r) => r.ratePercent))) / 1200;
      errors.push({
        field: 'term',
        message: `При таком платеже кредит не погасить и за 50 лет: проценты за месяц уже ${fmtMoney(interest)}, платёж должен быть заметно больше`,
      });
    } else state.months = found;
  }
  return { state, errors };
}

function showErrors(refs: FormRefs, errors: FieldError[]): void {
  qa(refs.form, '.control--invalid').forEach((c) => c.classList.remove('control--invalid'));
  clear(refs.errors);
  refs.errors.hidden = errors.length === 0;
  const seen = new Set<string>();
  for (const error of errors) {
    const key = error.field + error.message;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.errors.append(el('li', { text: error.message }));
    const [group, index] = error.field.split('.');
    let target: Element | null = null;
    if (group === 'amount') target = refs.amount.closest('.control');
    else if (group === 'rate' || (group === 'rates' && index === '0'))
      target = refs.rate.closest('.control');
    else if (group === 'term' || group === 'months') target = refs.term.closest('.control');
    else if (group === 'rates') target = qa(refs.rates, '[data-row]')[Number(index) - 1] ?? null;
    else if (group === 'grace') target = qa(refs.grace, '[data-row]')[Number(index)] ?? null;
    else if (group === 'prepayments')
      target = qa(refs.prepayments, '[data-row]')[Number(index)] ?? null;
    if (target) {
      target.classList.add('control--invalid');
      if (target.closest('[data-extra]')) refs.extra.open = true;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Результаты                                                          */
/* ------------------------------------------------------------------ */

function renderSummary(root: HTMLElement, state: CalculatorState, r: ScheduleResult): void {
  renderKeyFigures(root, state, r);
  /* Подсказка в поле — значение по умолчанию для текущего расчёта */
  const extraField = root.querySelector<HTMLInputElement>('[data-field="extra-overpayment"]');
  if (extraField) {
    extraField.placeholder = formatAmountInput(String(suggestedExtra(state, r)));
  }
  q(root, '[data-out="legend-grace"]').hidden = r.summary.graceMonths === 0;
  q(root, '[data-out="legend-prepay"]').hidden = r.summary.totalPrepaid === 0;

  const hint = q(root, '[data-out="extra-hint"]');
  const extras: string[] = [];
  const periods = state.rates.length - 1;
  if (periods > 0) extras.push(`${periods} ${periods === 1 ? 'период ставки' : 'периода ставки'}`);
  if (state.gracePeriods?.length)
    extras.push(`отсрочка ${state.gracePeriods.reduce((a, g) => a + g.months, 0)} мес.`);
  const prepays = state.prepayments?.length ?? 0;
  if (prepays)
    extras.push(`${prepays} ${prepays === 1 ? 'досрочное погашение' : 'досрочных погашения'}`);
  if (state.interestInArrears) extras.push('проценты за предыдущий месяц');
  if (state.extraOverpayment !== undefined)
    extras.push(`переплата ${formatAmountInput(String(state.extraOverpayment))}`);
  hint.textContent = extras.length
    ? extras.join(', ')
    : 'ставка по периодам, отсрочка, досрочные погашения';
}

function renderEffect(root: HTMLElement, r: ScheduleResult): ReturnType<typeof prepaymentEffect> {
  const box = q(root, '[data-out="effect"]');
  const effect = prepaymentEffect(r);
  box.hidden = !effect;
  if (!effect) {
    box.innerHTML = '';
    return null;
  }
  box.innerHTML =
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
    ])}</dl>`;
  return effect;
}

function renderAnalysis(
  root: HTMLElement,
  state: CalculatorState,
  r: ScheduleResult,
  baseline?: ScheduleResult,
): void {
  q(root, '[data-chart="balance"]').innerHTML = balanceChart(r, baseline);
  q(root, '[data-chart="years"]').innerHTML = yearsChart(yearSummaries(r));
  q(root, '[data-out="balance-legend"]').hidden = !baseline;
  renderYearsTable(root, r);
  const rateBox = q(root, '[data-out="sens-rate"]');
  const termBox = q(root, '[data-out="sens-term"]');
  try {
    rateBox.innerHTML = sensitivityHtml(rateSensitivity(state), 'Ставка');
    termBox.innerHTML = sensitivityHtml(termSensitivity(state), 'Срок');
  } catch {
    /* вспомогательный блок: при экзотических параметрах просто пуст */
    rateBox.innerHTML = '';
    termBox.innerHTML = '';
  }
}

function renderTargetTerm(
  root: HTMLElement,
  state: CalculatorState,
  apply: (p: Prepayment) => void,
): void {
  const input = root.querySelector<HTMLInputElement>('[data-target-years]');
  const out = root.querySelector<HTMLElement>('[data-target-result]');
  if (!input || !out) return;
  const value = parseNumber(input.value);
  if (!Number.isFinite(value) || value <= 0) {
    clear(out);
    return;
  }
  const inYears =
    root.querySelector<HTMLInputElement>('input[name="target-unit"]:checked')?.value !== 'months';
  const target = inYears ? Math.round(value * 12) : Math.round(value);
  try {
    const base = { ...state, prepayments: [] };
    const extra = extraPaymentForTerm(base, target);
    if (extra === null) {
      out.textContent = target >= plannedMonths(state) ? 'Это не короче текущего срока' : '';
      return;
    }
    /* Доплаты начинаются с первого месяца, где гасится долг: в отсрочку их вносить нельзя */
    const firstPaying = buildSchedule(base).rows.find((r) => !r.isGrace)?.month ?? 1;
    const prepayment: Prepayment = {
      month: firstPaying,
      amount: extra,
      mode: 'term',
      repeat: 'monthly',
    };
    out.replaceChildren(
      el('span', {
        text: `Доплачивайте ${fmtMoney(extra)} каждый месяц сверх платежа — кредит закроется за ${fmtMonthsAsYears(target)}. `,
      }),
      el('button', {
        type: 'button',
        class: 'target__apply',
        text: 'Добавить доплату в график',
        onclick: () => {
          apply(prepayment);
          input.value = '';
          clear(out);
        },
      }),
    );
  } catch {
    clear(out);
  }
}

/* ------------------------------------------------------------------ */
/* Инициализация                                                       */
/* ------------------------------------------------------------------ */

function loadSaved(): CalculatorState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? decodeState(new URLSearchParams(raw)) : null;
  } catch {
    return null;
  }
}

function save(state: CalculatorState): void {
  try {
    localStorage.setItem(STORAGE_KEY, encodeState(state).toString());
  } catch {
    /* приватный режим */
  }
}

/** Меню действий на <details>: закрывается по клику вне, по Escape и после выбора */
function initMenu(menu: HTMLDetailsElement): void {
  document.addEventListener('click', (e) => {
    if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector<HTMLElement>('summary')?.focus();
    }
  });
  menu.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.menu__item')) setTimeout(() => (menu.open = false), 0);
  });
}

export function initCalculator(root: HTMLElement): void {
  const form = q<HTMLFormElement>(root, 'form[data-form]');
  const refs: FormRefs = {
    root,
    form,
    amount: q<HTMLInputElement>(form, '[data-field="amount"]'),
    rate: q<HTMLInputElement>(form, '[data-field="rate"]'),
    term: q<HTMLInputElement>(form, '[data-field="term"]'),
    termUnit: () => {
      if (q<HTMLInputElement>(form, 'input[name="term-mode"]:checked').value === 'payment')
        return 'payment';
      return q<HTMLInputElement>(form, 'input[name="term-unit"]:checked').value === 'years'
        ? 'years'
        : 'months';
    },
    termUnits: q(form, '[data-term-units]'),
    type: () =>
      q<HTMLInputElement>(form, 'input[name="type"]:checked').value === 'diff' ? 'diff' : 'annuity',
    rates: q(form, '[data-list="rates"]'),
    grace: q(form, '[data-list="grace"]'),
    graceExtends: q<HTMLInputElement>(form, '[data-field="grace-extends"]'),
    interestArrears: q<HTMLInputElement>(form, '[data-field="interest-arrears"]'),
    extraOverpayment: q<HTMLInputElement>(form, '[data-field="extra-overpayment"]'),
    prepayments: q(form, '[data-list="prepayments"]'),
    extra: q<HTMLDetailsElement>(form, '[data-extra]'),
    errors: q(form, '[data-errors]'),
  };
  const results = q(root, '[data-results]');
  const empty = q(root, '[data-empty]');

  /* Стартовое состояние: адрес → сохранённое → заданное страницей → по умолчанию */
  const pageInitial = root.dataset.initial
    ? (JSON.parse(root.dataset.initial) as CalculatorState)
    : DEFAULT_STATE;
  const fromUrl = new URLSearchParams(location.search);
  const hasUrlState = ['amount', 'months', 'payment', 'rate', 'a', 'n', 'r'].some((key) =>
    fromUrl.has(key),
  );
  const pageHasPreset = root.dataset.preset === '1';
  const initial = hasUrlState
    ? decodeState(fromUrl, pageInitial)
    : (!pageHasPreset && loadSaved()) || pageInitial;

  let current: CalculatorState = initial;

  /* Цель «закрыть за N лет» переносится в график обычной строкой досрочного погашения:
     её видно в условиях, можно править и удалить */
  const applyTarget = (p: Prepayment) => {
    clear(refs.prepayments);
    renderPrepaymentRow(refs.prepayments, p, scheduleRecalc);
    refs.extra.open = true;
    recalc();
    refs.prepayments.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  };

  const recalc = () => {
    const { state, errors } = readForm(refs);
    let result: ScheduleResult | null = null;
    if (errors.length === 0) {
      try {
        result = buildSchedule(state);
      } catch (e) {
        if (e instanceof ScheduleInputError) errors.push({ field: e.field, message: e.message });
        else
          errors.push({
            field: 'form',
            message: e instanceof Error ? e.message : 'Не удалось построить график',
          });
      }
    }
    showErrors(refs, errors);
    results.hidden = !result;
    empty.hidden = Boolean(result);
    if (!result) return;
    current = state;
    renderSummary(root, state, result);
    renderScheduleTable(root, result, extraOverpayment(state));
    const effect = renderEffect(root, result);
    renderAnalysis(root, state, result, effect?.baseline);
    renderTargetTerm(root, state, applyTarget);
    if (!pageHasPreset) save(state);
    const url = new URL(location.href);
    url.search = stateQuery(state);
    history.replaceState(null, '', url);
  };
  const scheduleRecalc = debounce(recalc, 150);

  fillForm(refs, initial, scheduleRecalc);

  form.addEventListener('input', scheduleRecalc);
  form.addEventListener('change', scheduleRecalc);
  /* Лишний символ в поле не появляется; подсказка висит пару секунд и уходит сама */
  guardNumericInputs(form, (input, message) => {
    const control = input.closest('.control') ?? input.closest('[data-row]');
    control?.classList.add('control--invalid');
    const duplicate = qa(refs.errors, 'li').find((li) => li.textContent === message);
    const item = duplicate ?? el('li', { text: message });
    if (!duplicate) refs.errors.append(item);
    refs.errors.hidden = false;
    setTimeout(() => {
      item.remove();
      control?.classList.remove('control--invalid');
      refs.errors.hidden = refs.errors.children.length === 0;
    }, 2000);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    recalc();
  });
  refs.amount.addEventListener('blur', () => {
    refs.amount.value = formatAmountInput(refs.amount.value);
  });

  /* Переключение лет, месяцев, срока и платежа пересчитывает число в поле, а не условия:
     в платёж подставляется текущий самый большой платёж, округлённый вверх до целого,
     обратно — подобранный срок */
  const termInField = () =>
    refs.termUnit() === 'years'
      ? String(Math.round((current.months / 12) * 100) / 100).replace('.', ',')
      : String(current.months);
  qa<HTMLInputElement>(form, 'input[name="term-unit"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      refs.term.value = termInField();
    }),
  );
  qa<HTMLInputElement>(form, 'input[name="term-mode"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      if (radio.value === 'payment') {
        let payment = 0;
        try {
          payment = Math.ceil(maxPlannedPayment(buildSchedule(current)));
        } catch {
          payment = 0;
        }
        refs.term.value = payment > 0 ? formatAmountInput(String(payment)) : '';
      } else refs.term.value = termInField();
      syncTermMode(refs);
    }),
  );
  refs.term.addEventListener('blur', () => {
    if (refs.termUnit() === 'payment') refs.term.value = formatAmountInput(refs.term.value);
  });

  qa<HTMLButtonElement>(form, '[data-add]').forEach((button) =>
    button.addEventListener('click', () => {
      const kind = button.dataset.add;
      const total = plannedMonths(current);
      let list = refs.prepayments;
      if (kind === 'rates') {
        const last = current.rates[current.rates.length - 1]!;
        renderRateRow(
          refs.rates,
          { fromMonth: Math.min(total, last.fromMonth + 12), ratePercent: last.ratePercent },
          scheduleRecalc,
        );
        list = refs.rates;
      } else if (kind === 'grace') {
        const lastEnd = (current.gracePeriods ?? []).reduce(
          (m, g) => Math.max(m, g.start + g.months),
          1,
        );
        renderGraceRow(
          refs.grace,
          { start: Math.min(total - 1, lastEnd), months: 6 },
          scheduleRecalc,
        );
        list = refs.grace;
      } else {
        renderPrepaymentRow(
          refs.prepayments,
          { month: 12, amount: Math.round(current.amount / 10), mode: 'term', repeat: 'once' },
          scheduleRecalc,
        );
      }
      list.lastElementChild?.querySelector<HTMLInputElement>('input')?.focus();
      scheduleRecalc();
    }),
  );

  const menu = root.querySelector<HTMLDetailsElement>('[data-menu]');
  if (menu) initMenu(menu);

  root.querySelector('[data-action="copy-link"]')?.addEventListener('click', async (e) => {
    const button = e.currentTarget as HTMLButtonElement;
    const url = new URL(location.href);
    url.search = stateQuery(current);
    try {
      await navigator.clipboard.writeText(url.toString());
      const label = button.textContent;
      button.textContent = 'Ссылка скопирована';
      setTimeout(() => (button.textContent = label), 1800);
    } catch {
      prompt('Скопируйте ссылку на расчёт', url.toString());
    }
  });
  root.querySelector('[data-action="csv"]')?.addEventListener('click', () => {
    downloadText(
      `calcwise-${current.type}-${current.amount}-${current.months}.csv`,
      scheduleToCsv(buildSchedule(current)),
      'text/csv;charset=utf-8',
    );
  });
  root.querySelector('[data-action="print"]')?.addEventListener('click', () => window.print());
  for (const action of ['compare', 'schedule']) {
    root
      .querySelector<HTMLAnchorElement>(`[data-action="${action}"]`)
      ?.addEventListener('click', (e) => {
        const link = e.currentTarget as HTMLAnchorElement;
        const url = new URL(link.href);
        url.search = action === 'compare' ? scenariosQuery([current]) : stateQuery(current);
        link.href = url.toString();
      });
  }
  qa<HTMLInputElement>(root, 'input[name="target-unit"]').forEach((radio) =>
    radio.addEventListener('change', () => renderTargetTerm(root, current, applyTarget)),
  );
  root.querySelector('[data-target-years]')?.addEventListener(
    'input',
    debounce(() => renderTargetTerm(root, current, applyTarget), 200),
  );

  recalc();
}
