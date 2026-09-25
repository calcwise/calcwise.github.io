import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fmtMoney,
  fmtMonths,
  fmtMonthsAsYears,
  fmtRate,
  fmtShort,
  formatAmountInput,
  parseInteger,
  parseNumber,
  plural,
} from './format.ts';

/* Intl в ru-RU разделяет разряды неразрывным пробелом — сравниваем с обычным */
const plain = (s: string) => s.replace(/[  ]/g, ' ');

test('fmtMoney: разряды пробелом, два знака, запятая', () => {
  assert.equal(plain(fmtMoney(1234567.891)), '1 234 567,89');
  assert.equal(plain(fmtMoney(0)), '0,00');
  assert.equal(plain(fmtMoney(3396.2)), '3 396,20');
});

test('fmtShort: тысячи и миллионы для осей графиков', () => {
  assert.equal(plain(fmtShort(1_234_567)), '1,2 млн');
  assert.equal(plain(fmtShort(12_345)), '12,3 тыс.');
  assert.equal(fmtShort(999), '999');
});

test('fmtRate: без лишних нулей, с запятой', () => {
  assert.equal(fmtRate(15.4), '15,4');
  assert.equal(fmtRate(12), '12');
  /* Ставка не округляется до сотых: 13,125% в договоре встречается */
  assert.equal(fmtRate(7.125), '7,125');
  assert.equal(fmtRate(7.12345), '7,1235');
});

test('parseNumber и parseInteger: пробелы и запятая, мусор — NaN', () => {
  assert.equal(parseNumber('250 000,5'), 250000.5);
  assert.equal(parseNumber('250 000'), 250000);
  assert.equal(parseNumber('15.4'), 15.4);
  for (const bad of ['', 'abc', '1e3', '1,2,3', '15%'])
    assert.ok(Number.isNaN(parseNumber(bad)), bad);
  assert.equal(parseInteger('1 200'), 1200);
  for (const bad of ['1,5', '-1', 'x']) assert.ok(Number.isNaN(parseInteger(bad)), bad);
});

test('formatAmountInput: разряды, не больше двух знаков дроби, не число — как есть', () => {
  assert.equal(plain(formatAmountInput('3000000.5')), '3 000 000,5');
  assert.equal(plain(formatAmountInput('3396.219')), '3 396,21');
  assert.equal(plain(formatAmountInput('250000')), '250 000');
  assert.equal(formatAmountInput('abc'), 'abc');
});

test('склонения и сроки', () => {
  assert.deepEqual(
    [1, 2, 5, 11, 21, 22, 25, 111].map((n) => plural(n, 'месяц', 'месяца', 'месяцев')),
    ['месяц', 'месяца', 'месяцев', 'месяцев', 'месяц', 'месяца', 'месяцев', 'месяцев'],
  );
  assert.equal(fmtMonths(21), '21 месяц');
  assert.equal(fmtMonthsAsYears(239), '19 лет 11 месяцев');
  assert.equal(fmtMonthsAsYears(24), '2 года');
  assert.equal(fmtMonthsAsYears(5), '5 месяцев');
});
