import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSchedule, rateSensitivity } from './mortgage/index.ts';
import type { ScheduleInput } from './mortgage/index.ts';
import { prepaymentEffect } from './mortgage/index.ts';
import {
  EXTRA_HINT_EMPTY,
  closingRowHtml,
  effectHtml,
  extraHintText,
  formValues,
  hasExtraConditions,
  describeState,
  extraOverpayment,
  figureText,
  keyStats,
  rowsCountText,
  scheduleRowsHtml,
  sensitivityHtml,
  shareText,
  statsHtml,
  suggestedExtra,
  yearsRowsHtml,
} from './schedule-render.ts';
import { DEFAULT_STATE } from './url-state.ts';
import type { CalculatorState } from './url-state.ts';

const plain = (s: string) => s.replace(/[  ]/g, ' ');
const text = (html: string) => plain(html.replace(/(<[^>]+>)+/g, '|'));
const bank = {
  amount: 250_000,
  months: 239,
  type: 'annuity' as const,
  rates: [{ fromMonth: 1, ratePercent: 15.4 }],
  gracePeriods: [{ start: 1, months: 12 }],
} satisfies ScheduleInput & { amount: number };
const state = (extra: Partial<CalculatorState> = {}): CalculatorState => ({
  ...DEFAULT_STATE,
  ...bank,
  ...extra,
});

test('главная цифра: аннуитет с отсрочкой и дифференцированный', () => {
  const a = figureText(buildSchedule(bank));
  assert.equal(a.label, 'Ежемесячный платёж');
  assert.equal(plain(a.value), '3 396,21');
  assert.equal(plain(a.note), 'в отсрочку 3 208,33');
  const d = figureText(
    buildSchedule({
      amount: 120_000,
      months: 12,
      type: 'diff',
      rates: [{ fromMonth: 1, ratePercent: 12 }],
    }),
  );
  assert.equal(d.label, 'Первый платёж');
  assert.equal(plain(d.value), '11 200,00');
  assert.equal(plain(d.note), 'последний 10 100,00');
});

test('ключевые цифры: порядок и доплата только если введена', () => {
  const r = buildSchedule(bank);
  assert.deepEqual(
    keyStats(r).map((s) => s.label),
    ['Всего выплачено', 'Срок', 'Переплата по процентам', 'Проценты за отсрочку'],
  );
  const withExtra = keyStats(r, 3396.21);
  assert.equal(withExtra.at(-1)!.label, 'Дополнительная переплата');
  assert.equal(plain(withExtra[0]!.value), '812 835,76');
  assert.equal(withExtra[0]!.note, 'с дополнительной переплатой');
  assert.equal(extraOverpayment(state()), 0);
  assert.equal(extraOverpayment(state({ extraOverpayment: 777 })), 777);
  assert.equal(extraOverpayment(state({ extraOverpayment: -5 })), 0);
  assert.equal(suggestedExtra(state(), r), 3396.21);
  assert.equal(
    suggestedExtra(state({ type: 'diff' }), buildSchedule({ ...bank, type: 'diff' })),
    3208.33,
  );
  /* В HTML попадают только экранированные подписи */
  assert.ok(!statsHtml([{ label: '<b>', value: '1' }, null]).includes('<b>'));
});

test('ключевые цифры с досрочкой: срок короче плана и строка «Досрочно внесено»', () => {
  const r = buildSchedule({
    ...bank,
    prepayments: [{ month: 13, amount: 50_000, mode: 'term', repeat: 'once' }],
  });
  const stats = keyStats(r);
  const term = stats.find((s) => s.label === 'Срок')!;
  assert.match(term.note!, /^вместо 19 лет 11 месяцев по плану$/);
  assert.equal(plain(stats.at(-1)!.value), '50 000,00');
  assert.match(text(closingRowHtml(r)), /Кредит закрыт в \d+-м месяце/);
  assert.equal(closingRowHtml(buildSchedule(bank)), '');
});

test('строки графика: «Платёж» — вся сумма месяца, нулевая строка доплаты', () => {
  const r = buildSchedule({
    ...bank,
    prepayments: [{ month: 1, amount: 1000, mode: 'term', repeat: 'once' }],
  });
  const first = text(scheduleRowsHtml(r).split('</tr>')[0]!);
  /* 3 208,33 процентов + 1 000 досрочно = 4 208,33 в столбце «Платёж» */
  assert.ok(first.includes('|4 208,33|'), first);
  const withExtra = scheduleRowsHtml(r, 500);
  assert.ok(withExtra.startsWith('<tr class="schedule__row schedule__row--extra">'));
  assert.ok(text(withExtra.split('</tr>')[0]!).includes('|500,00|'));
  /* «Выплачено всего» в первой строке включает доплату */
  assert.ok(text(withExtra.split('</tr>')[1]!).includes('|4 708,33|'));
  assert.ok(!scheduleRowsHtml(r).includes('schedule__row--extra'));
});

test('таблица по годам, счётчик строк, доли, чувствительность', () => {
  const r = buildSchedule(bank);
  assert.equal(yearsRowsHtml(r).match(/<tr>/g)!.length, 20);
  assert.ok(text(yearsRowsHtml(r)).startsWith('|1-й|38 499,96|0,00|38 499,96|250 000,00|'));
  assert.equal(rowsCountText(r), '239 платежей');
  const share = shareText(r);
  assert.equal(share.labelPrincipal, 'Основной долг 30,9%');
  assert.equal(share.labelInterest, 'Проценты 69,1%');
  const sens = sensitivityHtml(rateSensitivity(r.input), 'Ставка');
  assert.ok(sens.includes('<th scope="col">Ставка</th>'));
  assert.ok(text(sens).includes('15,4%'));
});

test('условия одной фразой: все виды настроек попадают в описание', () => {
  const described = plain(
    describeState(
      state({
        rates: [
          { fromMonth: 1, ratePercent: 5 },
          { fromMonth: 13, ratePercent: 15.4 },
        ],
        prepayments: [
          { month: 13, amount: 5000, mode: 'term', repeat: 'monthly', kind: 'budget' },
          { month: 24, amount: 10_000, mode: 'payment', repeat: 'once' },
          { month: 36, amount: 1000, mode: 'term', repeat: 'yearly' },
        ],
        interestInArrears: true,
        extraOverpayment: 3396.21,
        targetPayment: 3400,
      }),
    ),
  );
  for (const part of [
    '250 000,00 под 5% на 239 месяцев аннуитетными платежами',
    'срок подобран под платёж не больше 3 400,00',
    'ставка меняется: с 13-го месяца 15,4%',
    'отсрочка по долгу 12 месяцев с 1-го',
    'плачу всего 5 000,00 ежемесячно с 13-го с сокращением срока',
    'досрочно 10 000,00 в 24-м месяце с уменьшением платежа',
    'досрочно 1 000,00 ежегодно с 36-го с сокращением срока',
    'проценты за предыдущий месяц',
    'дополнительная переплата 3 396,21',
  ])
    assert.ok(described.includes(part), `нет «${part}» в «${described}»`);
});

test('значения формы при сборке: те же, что подставит скрипт', () => {
  const r = buildSchedule(bank);
  const v = formValues(state({ termInYears: false }), r);
  assert.deepEqual(
    { ...v, amount: plain(v.amount), payment: plain(v.payment) },
    {
      amount: '250 000',
      rate: '15,4',
      term: '239',
      unit: 'months',
      payment: '3 396,21',
      paymentLabel: 'Платёж в месяц',
    },
  );
  /* Годы, но срок не целый: введённый срок — месяцами, подобранный под платёж — дробью */
  assert.equal(formValues(state(), r).unit, 'months');
  const byPayment = formValues(state({ targetPayment: 3400 }), r);
  assert.deepEqual(
    [byPayment.unit, byPayment.term, plain(byPayment.payment)],
    ['years', '19,92', '3 400'],
  );
  assert.equal(formValues(state({ type: 'diff' }), null).paymentLabel, 'Первый платёж');
  assert.equal(formValues(state(), null).payment, '');
});

test('дополнительные условия: подсказка и раскрытие', () => {
  const empty = state({ gracePeriods: [] });
  assert.equal(hasExtraConditions(empty), false);
  assert.equal(extraHintText(empty), EXTRA_HINT_EMPTY);
  assert.equal(hasExtraConditions(state()), true);
  const prepayments = [1, 2, 3, 4, 5].map((month) => ({
    month,
    amount: 1,
    mode: 'term' as const,
    repeat: 'once' as const,
  }));
  assert.equal(
    plain(extraHintText(state({ prepayments, extraOverpayment: 777 }))),
    'отсрочка 12 мес., 5 досрочных погашений, переплата 777,00',
  );
});

test('блок эффекта досрочек: пусто без досрочек, экономия и срок с ними', () => {
  const plainResult = buildSchedule(bank);
  assert.equal(effectHtml(plainResult, prepaymentEffect(plainResult)), '');
  const r = buildSchedule({
    ...bank,
    prepayments: [{ month: 13, amount: 50_000, mode: 'term', repeat: 'once' }],
  });
  const html = text(effectHtml(r, prepaymentEffect(r)));
  assert.ok(html.includes('Экономия на процентах') && html.includes('Кредит закрыт раньше'), html);
});
