/*
 * Данные сайта в одном месте: название, адрес, разделы.
 * Контактов и цен у сервиса нет — это некоммерческий калькулятор.
 */

export interface SiteConfig {
  /** Название для шапки, футера, манифеста и разметки */
  readonly name: string;
  readonly siteUrl: string;
  /** Короткое описание сервиса для главной и Open Graph */
  readonly tagline: string;
  readonly description: string;
  /** Язык контента и локаль Open Graph */
  readonly lang: string;
  readonly locale: string;
  /** Страна аудитории: пресеты ставок и формулировки */
  readonly country: 'BY';
  /** Год запуска для строки в футере */
  readonly since: number;
}

export const siteConfig: SiteConfig = {
  name: 'Calcwise',
  siteUrl: 'https://calcwise.by',
  tagline: 'Калькулятор кредитов с графиком платежей по банковской методике',
  description:
    'Бесплатный калькулятор ипотеки и кредитов: аннуитетный и дифференцированный график, отсрочка по долгу, льготная ставка на первые месяцы, досрочные погашения и сравнение сценариев. Расчёт до копейки.',
  lang: 'ru',
  locale: 'ru_RU',
  country: 'BY',
  since: 2026,
};
