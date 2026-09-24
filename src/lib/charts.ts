/*
 * Графики на чистом SVG, без библиотек. Возвращают разметку строкой;
 * цвета — через классы и токены, чтобы работали обе темы и печать.
 */
import { fmtShort } from './format.ts';
import type { ScheduleResult, YearSummary } from './mortgage/index.ts';

const esc = (s: string) =>
  s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

interface Box {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const BOX: Box = { width: 720, height: 260, left: 64, right: 16, top: 16, bottom: 32 };

export function yTicks(max: number, count = 4): number[] {
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

/**
 * Кривая остатка долга по месяцам. Если есть база для сравнения (график без
 * досрочек), она рисуется пунктиром — видно, насколько раньше закрывается кредит.
 */
export function balanceChart(result: ScheduleResult, baseline?: ScheduleResult): string {
  const { width, height, left, right, top, bottom } = BOX;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const months = Math.max(result.rows.length, baseline?.rows.length ?? 0);
  const maxY = result.summary.amount;
  const ticks = yTicks(maxY);
  const yMax = ticks[ticks.length - 1]! || maxY;

  const x = (m: number) => left + (m / months) * plotW;
  const y = (v: number) => top + plotH - (v / yMax) * plotH;

  const path = (rows: ScheduleResult['rows']) =>
    [`M${x(0).toFixed(1)},${y(rows.length ? result.summary.amount : 0).toFixed(1)}`]
      .concat(rows.map((r) => `L${x(r.month).toFixed(1)},${y(r.balance).toFixed(1)}`))
      .join(' ');

  const grid = ticks
    .map(
      (v) =>
        `<line class="chart__grid" x1="${left}" x2="${width - right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>` +
        `<text class="chart__tick" x="${left - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${esc(fmtShort(v))}</text>`,
    )
    .join('');

  const yearStep = months > 120 ? 60 : months > 36 ? 12 : 6;
  const xLabels: string[] = [];
  for (let m = 0; m <= months; m += yearStep) {
    const label = m === 0 ? '0' : yearStep >= 12 ? `${m / 12} г.` : `${m} мес.`;
    xLabels.push(
      `<text class="chart__tick" x="${x(m).toFixed(1)}" y="${height - 10}" text-anchor="middle">${label}</text>`,
    );
  }

  const crossover = result.rows.find((r) => !r.isGrace && r.principal >= r.interest);
  const marker =
    crossover && crossover.month > 1 && crossover.month < result.rows.length
      ? `<line class="chart__marker" x1="${x(crossover.month).toFixed(1)}" x2="${x(crossover.month).toFixed(1)}" y1="${top}" y2="${top + plotH}"/>` +
        `<text class="chart__note" x="${(x(crossover.month) + 6).toFixed(1)}" y="${top + 14}">с ${crossover.month}-го месяца долг в платеже больше процентов</text>`
      : '';

  const base = baseline
    ? `<path class="chart__line chart__line--baseline" d="${path(baseline.rows)}"/>`
    : '';
  const area = `<path class="chart__area" d="${path(result.rows)} L${x(result.rows.length).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z"/>`;

  return (
    `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Остаток долга по месяцам">` +
    grid +
    xLabels.join('') +
    area +
    base +
    `<path class="chart__line" d="${path(result.rows)}"/>` +
    marker +
    `</svg>`
  );
}

/** Столбики по годам: основной долг и проценты в выплатах каждого года */
export function yearsChart(years: YearSummary[]): string {
  const { width, height, left, right, top, bottom } = BOX;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const maxY = Math.max(...years.map((y) => y.principal + y.interest));
  const ticks = yTicks(maxY);
  const yMax = ticks[ticks.length - 1]! || maxY;
  const slot = plotW / years.length;
  const bar = Math.max(2, Math.min(28, slot * 0.7));
  const y = (v: number) => top + plotH - (v / yMax) * plotH;

  const grid = ticks
    .map(
      (v) =>
        `<line class="chart__grid" x1="${left}" x2="${width - right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>` +
        `<text class="chart__tick" x="${left - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${esc(fmtShort(v))}</text>`,
    )
    .join('');

  const labelEvery = years.length > 20 ? 5 : years.length > 10 ? 2 : 1;
  const bars = years
    .map((yr, i) => {
      const cx = left + slot * i + slot / 2;
      const x0 = (cx - bar / 2).toFixed(1);
      const hPrincipal = (yr.principal / yMax) * plotH;
      const hInterest = (yr.interest / yMax) * plotH;
      const yInterest = top + plotH - hInterest;
      const yPrincipal = yInterest - hPrincipal;
      const label =
        (i + 1) % labelEvery === 0 || i === 0
          ? `<text class="chart__tick" x="${cx.toFixed(1)}" y="${height - 10}" text-anchor="middle">${yr.year}</text>`
          : '';
      const title = `<title>Год ${yr.year}: долг ${fmtShort(yr.principal)}, проценты ${fmtShort(yr.interest)}</title>`;
      return (
        `<g>${title}` +
        `<rect class="chart__bar chart__bar--interest" x="${x0}" y="${yInterest.toFixed(1)}" width="${bar.toFixed(1)}" height="${hInterest.toFixed(1)}"/>` +
        `<rect class="chart__bar chart__bar--principal" x="${x0}" y="${yPrincipal.toFixed(1)}" width="${bar.toFixed(1)}" height="${hPrincipal.toFixed(1)}"/>` +
        label +
        `</g>`
      );
    })
    .join('');

  return (
    `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Выплаты по годам: основной долг и проценты">` +
    grid +
    bars +
    `</svg>`
  );
}
