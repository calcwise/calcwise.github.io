import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isAllowedNumeric } from './numeric-input.ts';

test('decimal: цифры, пробелы-разделители и одна запятая или точка', () => {
  for (const ok of [
    '',
    '250 000',
    '250 000',
    '15,4',
    '15.4',
    '7,',
    ',5',
    '3396,21',
    '250 000,00 ',
    '3 396,21 ',
  ])
    assert.ok(isAllowedNumeric('decimal', ok), ok);
  for (const bad of ['abc', '15,4,', '1.2.3', '15%', '-5', '1e3', 'два'])
    assert.ok(!isAllowedNumeric('decimal', bad), bad);
});

test('numeric: только цифры', () => {
  for (const ok of ['', '12', '239', '1 200']) assert.ok(isAllowedNumeric('numeric', ok), ok);
  for (const bad of ['7,5', '7.5', 'x', '-1', '12a'])
    assert.ok(!isAllowedNumeric('numeric', bad), bad);
});
