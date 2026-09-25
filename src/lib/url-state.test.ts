import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_STATE,
  decodeScenarios,
  decodeState,
  encodeState,
  scenariosQuery,
  stateQuery,
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
