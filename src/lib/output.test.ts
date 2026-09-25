/* Экспорт, графики, SEO, меню и страницы-пресеты: всё, что строится из расчёта при сборке */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { balanceChart, yTicks, yearsChart } from './charts.ts';
import { scheduleToCsv } from './csv.ts';
import { isCurrentPath, navItems, normalizePath } from './menu.ts';
import { buildSchedule, prepaymentEffect, yearSummaries } from './mortgage/index.ts';
import { getMortgagePage, mortgagePages, pageState } from './mortgage-pages.ts';
import { buildTitle, canonicalUrl, clampDescription, faqJsonLd } from './seo.ts';

const input = {
  amount: 100_000,
  months: 24,
  type: 'annuity' as const,
  rates: [{ fromMonth: 1, ratePercent: 12 }],
  prepayments: [{ month: 3, amount: 20_000, mode: 'term' as const, repeat: 'once' as const }],
};

test('CSV: BOM, «;», десятичная запятая, строка на каждый месяц', () => {
  const r = buildSchedule(input);
  const csv = scheduleToCsv(r);
  assert.ok(csv.startsWith('﻿№;Ставка, %;Платёж;'));
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, r.rows.length + 1);
  assert.equal(
    lines[1],
    '1;12;4707,35;3707,35;1000,00;0,00;4707,35;96292,65;4707,35;3707,35;1000,00;104127,46;',
  );
  /* Досрочка в третьем месяце: «Всего за месяц» = платёж + досрочка */
  const third = lines[3]!.split(';');
  assert.equal(third[5], '20000,00');
  assert.equal(Number(third[6]!.replace(',', '.')), Number(third[2]!.replace(',', '.')) + 20000);
});

test('графики: SVG с подписью для читалок, деления оси от нуля', () => {
  const r = buildSchedule(input);
  const effect = prepaymentEffect(r)!;
  const svg = balanceChart(r, effect.baseline);
  assert.ok(svg.startsWith('<svg class="chart"'));
  assert.ok(svg.includes('role="img"') && svg.includes('aria-label='));
  assert.ok(!/NaN|Infinity|undefined/.test(svg));
  const years = yearsChart(yearSummaries(r));
  assert.ok(years.startsWith('<svg') && !/NaN|Infinity|undefined/.test(years));
  assert.deepEqual(yTicks(0), [0]);
  const ticks = yTicks(250_000);
  assert.equal(ticks[0], 0);
  assert.ok(ticks.every((t, i) => i === 0 || t > ticks[i - 1]!));
});

test('SEO: заголовок с брендом только если влезает, описание не длиннее 160', () => {
  assert.equal(buildTitle('Короткий'), 'Короткий — Calcwise');
  assert.equal(buildTitle('x'.repeat(58)), 'x'.repeat(58));
  assert.ok(clampDescription('а'.repeat(200)).length <= 160);
  assert.equal(canonicalUrl('https://calcwise.by', '/mortgage/'), 'https://calcwise.by/mortgage/');
  const faq = faqJsonLd([{ question: 'В?', answer: 'О.' }]) as { mainEntity: unknown[] };
  assert.equal(faq.mainEntity.length, 1);
});

test('меню: текущий раздел подсвечивается и на вложенных страницах', () => {
  assert.equal(normalizePath('/mortgage'), '/mortgage/');
  assert.ok(isCurrentPath('/mortgage/', '/mortgage/annuity/'));
  assert.ok(!isCurrentPath('/', '/mortgage/'));
  assert.ok(isCurrentPath('/', '/'));
  assert.ok(navItems.length >= 3);
});

test('страницы-пресеты: у каждой уникальный адрес и рабочий стартовый расчёт', () => {
  const slugs = mortgagePages.map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const page of mortgagePages) {
    assert.equal(getMortgagePage(page.slug), page);
    const r = buildSchedule(pageState(page));
    assert.ok(r.rows.length > 0 && r.rows.at(-1)!.balance === 0, page.slug);
  }
  assert.equal(getMortgagePage('nope'), undefined);
});
