/*
 * Страница «только график»: читает состояние из адреса, показывает условия,
 * ключевые цифры и полную таблицу без прокрутки внутри.
 */
import { downloadText, scheduleToCsv } from './csv.ts';
import { q } from './dom.ts';
import { buildSchedule } from './mortgage/index.ts';
import {
  extraOverpayment,
  renderKeyFigures,
  renderScheduleTable,
  renderYearsTable,
} from './schedule-render.ts';
import { DEFAULT_STATE, decodeState } from './url-state.ts';

export function initSchedulePage(root: HTMLElement): void {
  const state = decodeState(new URLSearchParams(location.search), DEFAULT_STATE);
  const error = q(root, '[data-error]');
  const content = q(root, '[data-content]');
  try {
    const result = buildSchedule(state);
    renderKeyFigures(root, state, result);
    renderScheduleTable(root, result, extraOverpayment(state));
    renderYearsTable(root, result);
    const legendGrace = root.querySelector<HTMLElement>('[data-out="legend-grace"]');
    if (legendGrace) legendGrace.hidden = result.summary.graceMonths === 0;
    const legendPrepay = root.querySelector<HTMLElement>('[data-out="legend-prepay"]');
    if (legendPrepay) legendPrepay.hidden = result.summary.totalPrepaid === 0;
    root.querySelector('[data-action="csv"]')?.addEventListener('click', () => {
      downloadText(
        `calcwise-${state.type}-${state.amount}-${state.months}.csv`,
        scheduleToCsv(result),
        'text/csv;charset=utf-8',
      );
    });
    root.querySelector('[data-action="print"]')?.addEventListener('click', () => window.print());
    error.hidden = true;
    content.hidden = false;
  } catch (e) {
    error.textContent =
      e instanceof Error ? e.message : 'Не удалось построить график по этим параметрам';
    error.hidden = false;
    content.hidden = true;
  }
}
