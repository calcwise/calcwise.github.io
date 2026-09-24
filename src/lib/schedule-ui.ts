/*
 * Страница «только график»: читает состояние из адреса, показывает условия,
 * ключевые цифры и полную таблицу без прокрутки внутри.
 */
import { downloadText, scheduleToCsv } from './csv.ts';
import { clear, el, q } from './dom.ts';
import { fmtMoney } from './format.ts';
import { buildSchedule } from './mortgage/index.ts';
import {
  describeState,
  keyStats,
  renderScheduleTable,
  renderYearsTable,
} from './schedule-render.ts';
import { DEFAULT_STATE, decodeState, encodeState } from './url-state.ts';

export function initSchedulePage(root: HTMLElement): void {
  const state = decodeState(new URLSearchParams(location.search), DEFAULT_STATE);
  const error = q(root, '[data-error]');
  const content = q(root, '[data-content]');
  try {
    const result = buildSchedule(state);
    q(root, '[data-out="conditions"]').textContent = describeState(state, result);
    const firstRegular = result.rows.find((r) => !r.isGrace) ?? result.rows[0]!;
    q(root, '[data-out="figure"]').textContent = fmtMoney(firstRegular.payment);
    q(root, '[data-out="figure-label"]').textContent =
      state.type === 'annuity' ? 'Ежемесячный платёж' : 'Первый платёж';
    const stats = q(root, '[data-out="stats"]');
    clear(stats);
    for (const item of keyStats(result)) {
      stats.append(
        el('div', { class: `stat${item.tone ? ` stat--${item.tone}` : ''}` }, [
          el('dt', { class: 'stat__label', text: item.label }),
          el('dd', { class: 'stat__value num', text: item.value }),
          item.note ? el('dd', { class: 'stat__note', text: item.note }) : null,
        ]),
      );
    }
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
