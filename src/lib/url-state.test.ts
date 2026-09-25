import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_STATE,
  decodeScenarios,
  decodeState,
  encodeState,
  scenariosQuery,
  stateQuery,
  stateUrl,
} from './url-state.ts';
import type { CalculatorState } from './url-state.ts';

const state: CalculatorState = {
  ...DEFAULT_STATE,
  amount: 180_000,
  months: 239,
  type: 'diff',
  rates: [
    { fromMonth: 1, ratePercent: 5 },
    { fromMonth: 13, ratePercent: 15.4 },
  ],
  gracePeriods: [{ start: 1, months: 12 }],
  prepayments: [
    { month: 1, amount: 4000, mode: 'payment', repeat: 'monthly', kind: 'budget' },
    { month: 24, amount: 10_000, mode: 'term', repeat: 'once' },
    { month: 3, amount: 500, mode: 'term', repeat: 'yearly', untilMonth: 60 },
  ],
  interestInArrears: true,
  extraOverpayment: 3208.33,
  termInYears: false,
};

test('адрес читается человеком: без %3A, %2C и %40, режимы словами', () => {
  const query = stateQuery(state);
  assert.equal(
    query,
    'amount=180000&months=239&type=diff&rate=5@1,15.4@13&grace=1x12&prepay=1:4000:payment:monthly:budget,24:10000:term:once,3:500:term:yearly:60&interest=previous-month&extra=3208.33&unit=months',
  );
  assert.ok(!/%/.test(query));
});

test('адрес разбирается обратно в то же состояние', () => {
  assert.deepEqual(decodeState(new URLSearchParams(stateQuery(state))), state);
});

test('старые короткие ключи и формы досрочек читаются', () => {
  const old = decodeState(
    new URLSearchParams(
      'a=180000&n=239&t=diff&r=5@1,15.4@13&g=1x12&p=1:4000:p:m::b,24:10000:t:o,3:500:t:y:60&ia=1&x=3208.33&y=0',
    ),
  );
  assert.deepEqual(old, state);
});

test('сравнение: сценарии ключами с номером, без вложенного запроса и %', () => {
  const second: CalculatorState = { ...DEFAULT_STATE, type: 'diff' };
  const query = scenariosQuery([state, second]);
  assert.ok(!/%/.test(query), query);
  assert.ok(query.startsWith('1.amount=180000&1.months=239&1.type=diff'), query);
  assert.ok(query.includes('&2.amount=250000&2.months=240&2.type=diff'), query);
  assert.deepEqual(decodeScenarios(new URLSearchParams(query), 3), [state, second]);
});

test('сравнение: старый формат с параметром s читается, лишние сценарии отбрасываются', () => {
  const params = new URLSearchParams();
  for (let i = 0; i < 4; i++) params.append('s', encodeState(state).toString());
  const scenarios = decodeScenarios(params, 3);
  assert.equal(scenarios.length, 3);
  assert.deepEqual(scenarios[0], state);
  assert.deepEqual(decodeScenarios(new URLSearchParams('4.amount=1'), 3), []);
});

test('расчёт по платежу: в адресе payment вместо months, срок подбирается при чтении', () => {
  const query = 'amount=250000&payment=3396.21&type=annuity&rate=15.4&grace=1x12';
  const decoded = decodeState(new URLSearchParams(query));
  assert.equal(decoded.targetPayment, 3396.21);
  assert.equal(decoded.months, 239);
  const encoded = stateQuery(decoded);
  assert.ok(encoded.includes('payment=3396.21'), encoded);
  assert.ok(!encoded.includes('months='), encoded);
  /* Без payment прежний адрес не несёт расчёта по платежу */
  assert.equal(decodeState(new URLSearchParams('amount=1&months=12')).targetPayment, undefined);
});

test('ссылка на расчёт: путь страницы сохраняется, запрос читаемый', () => {
  const url = stateUrl({ ...DEFAULT_STATE }, 'https://calcwise.by/mortgage/?old=1#top');
  assert.equal(
    url,
    'https://calcwise.by/mortgage/?amount=250000&months=240&type=annuity&rate=15.4#top',
  );
});

test('битые досрочки и ставки в адресе не ломают разбор', () => {
  const s = decodeState(new URLSearchParams('amount=250000&months=240&prepay=12,5:1000:term:once'));
  assert.deepEqual(s.prepayments, [{ month: 5, amount: 1000, mode: 'term', repeat: 'once' }]);
  const r = decodeState(new URLSearchParams('amount=1&months=12&rate=abc'));
  assert.equal(r.rates[0]!.ratePercent, DEFAULT_STATE.rates[0]!.ratePercent);
});

test('ставка с тремя знаками возвращается по ссылке без округления', () => {
  const s = { ...DEFAULT_STATE, rates: [{ fromMonth: 1, ratePercent: 13.125 }] };
  const back = decodeState(new URLSearchParams(stateQuery(s)));
  assert.equal(back.rates[0]!.ratePercent, 13.125);
});

test('пустые отсрочка и досрочки в адресе не берутся из пресета страницы', () => {
  const preset = { ...DEFAULT_STATE, gracePeriods: [{ start: 1, months: 12 }] };
  /* Калькулятор раскодирует адрес поверх значений по умолчанию, а не пресета */
  const s = decodeState(new URLSearchParams('amount=250000&months=240&rate=15.4'), DEFAULT_STATE);
  assert.deepEqual(s.gracePeriods, []);
  assert.deepEqual(
    decodeState(new URLSearchParams('amount=1'), preset).gracePeriods,
    preset.gracePeriods,
  );
});
