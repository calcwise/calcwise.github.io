/*
 * Страница сравнения: до трёх сценариев рядом. Каждый сценарий — полное
 * состояние калькулятора (те же параметры адреса, что у /mortgage/), поэтому
 * сюда можно прийти по кнопке «Сравнить» с любой настройкой.
 */
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
import { buildSchedule } from './mortgage/index.ts';
import type { ScheduleResult } from './mortgage/index.ts';
import { DEFAULT_STATE, decodeScenarios, scenariosQuery } from './url-state.ts';
import type { CalculatorState } from './url-state.ts';
import { fmtShort } from './format.ts';
import { yTicks } from './charts.ts';

const MAX = 3;
const NAMES = ['А', 'Б', 'В'];

interface Scenario {
  state: CalculatorState;
  card: HTMLElement;
}

function scenarioCard(
  index: number,
  state: CalculatorState,
  onChange: () => void,
  onRemove: () => void,
): HTMLElement {
  const grace = state.gracePeriods?.[0];
  const extra = state.prepayments?.find((p) => p.repeat === 'monthly');
  const input = (attrs: Record<string, string | number | boolean | undefined>) =>
    el('input', {
      class: 'control__input num',
      inputmode: 'decimal',
      autocomplete: 'off',
      ...attrs,
    });
  const control = (label: string, field: HTMLElement, unit?: string) =>
    el('label', { class: 'control' }, [
      el('span', { class: 'control__label', text: label }),
      el('span', { class: 'control__field' }, [
        field,
        unit ? el('span', { class: 'control__unit', text: unit }) : null,
      ]),
    ]);
  const secondRate = state.rates[1];
  const card = el('section', { class: 'scenario', 'data-scenario': String(index) }, [
    el('header', { class: 'scenario__head' }, [
      el('h2', { class: 'scenario__title', text: `Сценарий ${NAMES[index]}` }),
      el(
        'button',
        {
          type: 'button',
          class: 'row__remove',
          'aria-label': 'Удалить сценарий',
          title: 'Удалить сценарий',
          onclick: onRemove,
        },
        [el('span', { 'aria-hidden': 'true', text: '×' })],
      ),
    ]),
    control(
      'Сумма',
      input({ 'data-key': 'amount', value: formatAmountInput(String(state.amount)) }),
    ),
    el('div', { class: 'scenario__pair' }, [
      control(
        'Ставка',
        input({ 'data-key': 'rate', value: fmtRate(state.rates[0]!.ratePercent) }),
        '%',
      ),
      control(
        'Срок',
        input({ 'data-key': 'months', inputmode: 'numeric', value: String(state.months) }),
        'мес.',
      ),
    ]),
    el('div', { class: 'scenario__pair' }, [
      control(
        'Ставка с месяца',
        input({
          'data-key': 'rate2from',
          inputmode: 'numeric',
          value: secondRate ? String(secondRate.fromMonth) : '',
          placeholder: 'нет',
        }),
        '№',
      ),
      control(
        'Новая ставка',
        input({
          'data-key': 'rate2',
          value: secondRate ? fmtRate(secondRate.ratePercent) : '',
          placeholder: 'нет',
        }),
        '%',
      ),
    ]),
    el('div', { class: 'control' }, [
      el('span', { class: 'control__label', text: 'Тип платежей' }),
      el(
        'div',
        {
          class: 'segmented',
          role: 'radiogroup',
          'aria-label': 'Тип платежей',
          'data-key': 'type',
        },
        [
          el('label', { class: 'segmented__option' }, [
            el('input', {
              type: 'radio',
              name: `type-${index}`,
              value: 'annuity',
              checked: state.type === 'annuity',
            }),
            el('span', { text: 'Аннуитетный' }),
          ]),
          el('label', { class: 'segmented__option' }, [
            el('input', {
              type: 'radio',
              name: `type-${index}`,
              value: 'diff',
              checked: state.type === 'diff',
            }),
            el('span', { text: 'Дифференцированный' }),
          ]),
        ],
      ),
    ]),
    el('div', { class: 'scenario__pair' }, [
      control(
        'Отсрочка по долгу',
        input({
          'data-key': 'grace',
          inputmode: 'numeric',
          value: grace ? String(grace.months) : '0',
        }),
        'мес.',
      ),
      control(
        'Доплата в месяц',
        input({
          'data-key': 'extra',
          value: extra ? formatAmountInput(String(extra.amount)) : '0',
        }),
      ),
    ]),
    el('p', {
      class: 'scenario__hint',
      text: 'Полный набор настроек — на странице калькулятора, оттуда сценарий переносится кнопкой «Сравнить».',
    }),
  ]);
  card.addEventListener('input', onChange);
  card.addEventListener('change', onChange);
  return card;
}

function readScenario(card: HTMLElement, base: CalculatorState): CalculatorState | null {
  const value = (key: string) => q<HTMLInputElement>(card, `[data-key="${key}"]`).value;
  const type =
    card.querySelector<HTMLInputElement>('[data-key="type"] input:checked')?.value === 'diff'
      ? 'diff'
      : 'annuity';
  const amount = parseNumber(value('amount'));
  const rate = parseNumber(value('rate'));
  const months = parseInteger(value('months'));
  const graceMonths = parseInteger(value('grace') || '0');
  const extra = parseNumber(value('extra') || '0');
  const rate2from = value('rate2from').trim();
  const rate2 = value('rate2').trim();
  if (!(amount > 0) || !(rate >= 0) || !(months >= 1)) return null;
  const rates = [{ fromMonth: 1, ratePercent: rate }];
  if (rate2from !== '' && rate2 !== '') {
    const from = parseInteger(rate2from);
    const percent = parseNumber(rate2);
    if (from > 1 && percent >= 0) rates.push({ fromMonth: from, ratePercent: percent });
  }
  const gracePeriods = graceMonths > 0 ? [{ start: 1, months: graceMonths }] : [];
  const prepayments =
    extra > 0
      ? [
          {
            month: graceMonths + 1,
            amount: extra,
            mode: 'term' as const,
            repeat: 'monthly' as const,
          },
        ]
      : [];
  const scenario: CalculatorState = {
    ...base,
    amount,
    months,
    type,
    rates,
    gracePeriods,
    prepayments,
    graceExtendsTerm: base.graceExtendsTerm,
  };
  /* В карточке сравнения срок вводится месяцами: расчёт по платежу здесь не действует */
  delete scenario.targetPayment;
  return scenario;
}

interface Metric {
  label: string;
  value: (r: ScheduleResult) => number;
  format: (n: number) => string;
  /** Что лучше: меньше или больше */
  better: 'min' | 'max' | 'none';
}

const METRICS: Metric[] = [
  {
    label: 'Первый обычный платёж',
    value: (r) => r.summary.regularPayment,
    format: fmtMoney,
    better: 'min',
  },
  {
    label: 'Максимальный платёж',
    value: (r) => r.summary.maxPayment,
    format: fmtMoney,
    better: 'min',
  },
  {
    label: 'Переплата по процентам',
    value: (r) => r.summary.totalInterest,
    format: fmtMoney,
    better: 'min',
  },
  {
    label: 'Переплата, % от суммы',
    value: (r) => r.summary.overpaymentPercent,
    format: (n) => `${fmtRate(n)}%`,
    better: 'min',
  },
  { label: 'Всего выплачено', value: (r) => r.summary.totalPaid, format: fmtMoney, better: 'min' },
  {
    label: 'Фактический срок',
    value: (r) => r.summary.actualMonths,
    format: fmtMonthsAsYears,
    better: 'min',
  },
  {
    label: 'Проценты за отсрочку',
    value: (r) => r.summary.graceInterest,
    format: fmtMoney,
    better: 'none',
  },
  {
    label: 'Досрочно внесено',
    value: (r) => r.summary.totalPrepaid,
    format: fmtMoney,
    better: 'none',
  },
];

function renderTable(box: HTMLElement, results: Array<ScheduleResult | null>): void {
  clear(box);
  const live = results.filter((r): r is ScheduleResult => r !== null);
  if (live.length === 0) {
    box.append(
      el('p', {
        class: 'compare__empty',
        text: 'Заполните хотя бы один сценарий: сумма, ставка и срок.',
      }),
    );
    return;
  }
  const head = el('tr', {}, [
    el('th', { scope: 'col', text: 'Показатель' }),
    ...results.map((r, i) =>
      el('th', {
        scope: 'col',
        text: r ? `Сценарий ${NAMES[i]}` : `Сценарий ${NAMES[i]} (не задан)`,
      }),
    ),
  ]);
  const rows = METRICS.filter((m) => live.some((r) => m.value(r) !== 0)).map((m) => {
    const values = results.map((r) => (r ? m.value(r) : null));
    const defined = values.filter((v): v is number => v !== null);
    const best =
      m.better === 'none' || defined.length < 2
        ? null
        : m.better === 'min'
          ? Math.min(...defined)
          : Math.max(...defined);
    const allEqual = defined.every((v) => v === defined[0]);
    return el('tr', {}, [
      el('th', { scope: 'row', text: m.label }),
      ...values.map((v) =>
        el('td', {
          class: `num${v !== null && best !== null && v === best && !allEqual ? ' compare__best' : ''}`,
          text: v === null ? '' : m.format(v),
        }),
      ),
    ]);
  });
  box.append(
    el('table', { class: 'compare__table' }, [el('thead', {}, [head]), el('tbody', {}, rows)]),
  );

  if (live.length >= 2) {
    const [a, b] = [live[0]!, live[1]!];
    const diff = Math.abs(a.summary.totalInterest - b.summary.totalInterest);
    const cheaper = a.summary.totalInterest <= b.summary.totalInterest ? 0 : 1;
    const names = results.map((r, i) => (r ? NAMES[i] : null)).filter(Boolean);
    box.append(
      el('p', { class: 'compare__verdict' }, [
        `Сценарий ${names[cheaper]} дешевле по процентам на `,
        el('strong', { class: 'num', text: fmtMoney(diff) }),
        live.length === 2 ? '.' : ' по сравнению со следующим.',
      ]),
    );
  }
}

function renderChart(box: HTMLElement, results: Array<ScheduleResult | null>): void {
  const live = results
    .map((r, i) => ({ r, i }))
    .filter((x): x is { r: ScheduleResult; i: number } => x.r !== null);
  if (live.length === 0) {
    box.innerHTML = '';
    q(box.parentElement!, '[data-legend]').replaceChildren();
    return;
  }
  const width = 720;
  const height = 260;
  const left = 64;
  const right = 16;
  const top = 16;
  const bottom = 32;
  const months = Math.max(...live.map((x) => x.r.rows.length));
  const ticks = yTicks(Math.max(...live.map((x) => x.r.summary.amount)));
  const maxY = ticks[ticks.length - 1]!;
  const x = (m: number) => left + (m / months) * (width - left - right);
  const y = (v: number) => top + (height - top - bottom) - (v / maxY) * (height - top - bottom);
  const lines = live
    .map(({ r, i }) => {
      const d = [
        `M${x(0).toFixed(1)},${y(r.summary.amount).toFixed(1)}`,
        ...r.rows.map((row) => `L${x(row.month).toFixed(1)},${y(row.balance).toFixed(1)}`),
      ].join(' ');
      return `<path class="chart__line chart__line--s${i}" d="${d}"/>`;
    })
    .join('');
  const grid = ticks
    .map(
      (v) =>
        `<line class="chart__grid" x1="${left}" x2="${width - right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="chart__tick" x="${left - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${fmtShort(v)}</text>`,
    )
    .join('');
  const step = months > 120 ? 60 : 12;
  let labels = '';
  for (let m = 0; m <= months; m += step)
    labels += `<text class="chart__tick" x="${x(m).toFixed(1)}" y="${height - 10}" text-anchor="middle">${m === 0 ? '0' : `${m / 12} г.`}</text>`;
  box.innerHTML = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Остаток долга по сценариям">${grid}${labels}${lines}</svg>`;
  const legend = q(box.parentElement!, '[data-legend]');
  clear(legend);
  live.forEach(({ i }) =>
    legend.append(
      el('span', { class: `legend__item legend__item--s${i}` }, [el('i'), `Сценарий ${NAMES[i]}`]),
    ),
  );
}

export function initCompare(root: HTMLElement): void {
  /* Лишний символ в поле не появляется, поле на пару секунд подсвечивается как неверное */
  guardNumericInputs(root, (input) => {
    const control = input.closest('.control');
    control?.classList.add('control--invalid');
    setTimeout(() => control?.classList.remove('control--invalid'), 2000);
  });
  const list = q(root, '[data-scenarios]');
  const table = q(root, '[data-compare-table]');
  const chart = q(root, '[data-compare-chart]');
  const addButton = q<HTMLButtonElement>(root, '[data-add-scenario]');
  const scenarios: Scenario[] = [];

  const recalc = () => {
    const results = scenarios.map((s) => {
      const state = readScenario(s.card, s.state);
      if (!state) return null;
      try {
        s.state = state;
        return buildSchedule(state);
      } catch {
        return null;
      }
    });
    renderTable(table, results);
    renderChart(chart, results);
    addButton.hidden = scenarios.length >= MAX;
    const url = new URL(location.href);
    url.search = scenariosQuery(scenarios.map((s) => s.state));
    history.replaceState(null, '', url);
  };
  const scheduleRecalc = debounce(recalc, 150);

  const add = (state: CalculatorState) => {
    if (scenarios.length >= MAX) return;
    const index = scenarios.length;
    const scenario: Scenario = { state, card: el('div') };
    scenario.card = scenarioCard(index, state, scheduleRecalc, () => {
      scenario.card.remove();
      scenarios.splice(scenarios.indexOf(scenario), 1);
      qa(list, '.scenario__title').forEach((t, i) => (t.textContent = `Сценарий ${NAMES[i]}`));
      recalc();
    });
    scenarios.push(scenario);
    list.append(scenario.card);
  };

  const fromUrl = decodeScenarios(new URLSearchParams(location.search), MAX);
  if (fromUrl.length) {
    fromUrl.forEach((state) => add(state));
    if (fromUrl.length === 1) {
      /* Пришли с одним сценарием: рядом сразу ставим альтернативу — другой тип платежей */
      const base = scenarios[0]!.state;
      add({ ...base, type: base.type === 'annuity' ? 'diff' : 'annuity' });
    }
  } else {
    add({ ...DEFAULT_STATE });
    add({ ...DEFAULT_STATE, type: 'diff' });
  }

  addButton.addEventListener('click', () => {
    const last = scenarios[scenarios.length - 1]?.state ?? DEFAULT_STATE;
    add({ ...last, months: Math.max(12, last.months - 60) });
    recalc();
    scenarios[scenarios.length - 1]?.card.querySelector<HTMLInputElement>('input')?.focus();
  });

  recalc();
}
