/*
 * Speculation Rules: предзагрузка внутренних страниц при наведении.
 * Работает в Chrome и Edge, остальные браузеры правило игнорируют.
 * ВАЖНО при подключении аналитики: пререндер выполняет скрипты страницы,
 * Яндекс.Метрике нужна проверка document.prerendering (см. TODO.md).
 */

const EXCLUDED = ['/*.xml', '/*.txt', '/*.json', '/*.webmanifest'];

export function speculationRules(): string {
  return JSON.stringify({
    prerender: [
      {
        where: {
          and: [
            { href_matches: '/*' },
            ...EXCLUDED.map((pattern) => ({ not: { href_matches: pattern } })),
          ],
        },
        eagerness: 'moderate',
      },
    ],
  });
}
