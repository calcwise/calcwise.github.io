/*
 * Фильтр ввода в числовые поля: лишний символ не попадает в поле, а пользователь
 * получает короткую подсказку. Одно событие beforeinput на корне, поля узнаются
 * по inputmode: decimal — число с дробной частью, numeric — целое.
 * Проверяется значение, каким оно станет после вставки, поэтому пробелы-разделители
 * («250 000») и одна запятая или точка проходят, а буквы и второй разделитель — нет.
 */

const DECIMAL = /^[\d\s]*[.,]?\d*$/;
const INTEGER = /^[\d\s]*$/;

export const NUMERIC_MESSAGES = {
  decimal: 'Только цифры, дробная часть через запятую',
  numeric: 'Только целое число',
} as const;

export type NumericMode = keyof typeof NUMERIC_MESSAGES;

/** Может ли поле с таким режимом содержать такое значение (в том числе недописанное) */
export const isAllowedNumeric = (mode: NumericMode, value: string): boolean =>
  (mode === 'decimal' ? DECIMAL : INTEGER).test(value);

/** Текст, который попадёт в поле: набор, вставка из буфера или перетаскивание */
function insertedText(e: InputEvent): string {
  if (e.data !== null) return e.data;
  return e.dataTransfer?.getData('text/plain') ?? '';
}

export function guardNumericInputs(
  root: HTMLElement,
  onBlocked: (input: HTMLInputElement, message: string) => void,
): void {
  root.addEventListener('beforeinput', (event) => {
    const e = event as InputEvent;
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    const mode = input.inputMode;
    if (mode !== 'decimal' && mode !== 'numeric') return;
    if (!e.inputType.startsWith('insert')) return;
    const text = insertedText(e);
    if (text === '') return;

    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const next = input.value.slice(0, start) + text + input.value.slice(end);
    if (isAllowedNumeric(mode, next)) return;

    e.preventDefault();
    onBlocked(input, NUMERIC_MESSAGES[mode]);
  });
}
