/*
 * SEO: мета-теги и генераторы JSON-LD — чистые функции.
 * Вставка в <head> — задача src/components/templates/base-layout.astro.
 */

/** Бренд добавляется только в <title>, в H1 его нет */
const TITLE_SUFFIX = ' — Calcwise';
/** Дальше поисковики обрезают заголовок многоточием */
const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;

export interface PageSeo {
  /** Заголовок страницы без брендового хвоста */
  title: string;
  description: string;
  /** Путь от корня с завершающим слешем, например "/mortgage/compare/" */
  path: string;
  ogType?: 'website' | 'article';
  /** Страница не для поиска (404): noindex и без canonical */
  noindex?: boolean;
}

/** Бренд добавляем, только если он поместится целиком */
export function buildTitle(title: string): string {
  const full = `${title}${TITLE_SUFFIX}`;
  return full.length <= TITLE_MAX ? full : title;
}

export function clampDescription(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= DESCRIPTION_MAX) return clean;
  return `${clean.slice(0, DESCRIPTION_MAX - 1).replace(/\s+\S*$/, '')}…`;
}

export function canonicalUrl(siteUrl: string, path: string): string {
  return new URL(path, siteUrl).toString();
}

/**
 * JSON для вставки внутрь <script>: угловая скобка уходит в <, иначе
 * «</script>» в тексте закрыл бы тег.
 */
export function jsonLdText(data: object): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export interface WebSiteParams {
  name: string;
  url: string;
  description: string;
  lang: string;
}

/** Паспорт сайта: связывает страницы в одну сущность для поисковиков */
export function webSiteJsonLd(p: WebSiteParams): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${p.url}/#website`,
    name: p.name,
    url: `${p.url}/`,
    description: p.description,
    inLanguage: p.lang,
    publisher: { '@id': `${p.url}/#organization` },
  };
}

export function organizationJsonLd(p: { name: string; url: string; logoUrl: string }): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${p.url}/#organization`,
    name: p.name,
    url: `${p.url}/`,
    logo: p.logoUrl,
  };
}

export interface WebAppParams {
  name: string;
  url: string;
  description: string;
  siteUrl: string;
  /** Что умеет калькулятор — попадает в featureList */
  features: string[];
}

/**
 * Разметка калькулятора как бесплатного веб-приложения: поисковики показывают
 * такие страницы с пометкой «Бесплатно» и понимают, что это инструмент, а не статья.
 */
export function webApplicationJsonLd(p: WebAppParams): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: p.name,
    url: p.url,
    description: p.description,
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript',
    inLanguage: 'ru',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'BYN' },
    featureList: p.features,
    publisher: { '@id': `${p.siteUrl}/#organization` },
  };
}

export interface FaqItem {
  question: string;
  answer: string;
}

export function faqJsonLd(items: FaqItem[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

export interface Crumb {
  name: string;
  path: string;
}

export function breadcrumbsJsonLd(siteUrl: string, crumbs: Crumb[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: canonicalUrl(siteUrl, crumb.path),
    })),
  };
}

export interface ArticleParams {
  headline: string;
  description: string;
  url: string;
  siteUrl: string;
  datePublished: string;
  dateModified: string;
}

export function articleJsonLd(p: ArticleParams): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: p.headline,
    description: p.description,
    mainEntityOfPage: p.url,
    inLanguage: 'ru',
    datePublished: p.datePublished,
    dateModified: p.dateModified,
    author: { '@id': `${p.siteUrl}/#organization` },
    publisher: { '@id': `${p.siteUrl}/#organization` },
  };
}
