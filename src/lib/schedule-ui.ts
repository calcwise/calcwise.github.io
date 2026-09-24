/*
 * Страница «только график»: читает состояние из адреса, показывает условия,
 * ключевые цифры и полную таблицу без прокрутки внутри.
 */
import { downloadText, scheduleToCsv } from './csv.ts';
import { q } from './dom.ts';
import { buildSchedule } from './mortgage/index.ts';
import { renderKeyFigures, renderScheduleTable, renderYearsTable } from './schedule-render.ts';
import { DEFAULT_STATE, decodeState, encodeState } from './url-state.ts';

export function initSchedulePage(root: HTMLElement): void {
  const state = decodeState(new URLSearchParams(location.search), DEFAULT_STATE);
  const error = q(root, '[data-error]');
  const content = q(root, '[data-content]');
  try {
    const result = buildSchedule(state);
    renderKeyFigures(root, state, result);
    renderScheduleTable(root, result);
    renderYearsTable(root, result);
    const back = q<HTMLAnchorElement>(root, '[data-action="back"]');
    back.href = `/mortgage/?${encodeState(state).toString()}`;
    root.querySelector('[data-action="csv"]')?.addEventListener('click', () => {
      downloadText(
        `amortize-${state.type}-${state.amount}-${state.months}.csv`,
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
