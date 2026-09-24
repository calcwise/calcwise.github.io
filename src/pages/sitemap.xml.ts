/*
 * Карта сайта собирается из файлов src/pages и списка страниц ипотеки:
 * забыть новую страницу нельзя. Даты — из git-истории (lib/lastmod).
 */
import type { APIRoute } from 'astro';
import { siteConfig } from '@/config/site';
import { lastModified } from '@/lib/lastmod';
import { mortgagePages } from '@/lib/mortgage-pages';

const escapeXml = (text: string): string =>
  text.replace(
    /[<>&'"]/g,
    (char) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] ?? char,
  );

const absolute = (path: string): string => new URL(path, siteConfig.siteUrl).toString();

function staticPages(): { path: string; files: string[] }[] {
  const modules = import.meta.glob('/src/pages/**/*.astro');
  return Object.keys(modules)
    .map((file) => ({
      file: file.slice(1),
      path: file.replace('/src/pages', '').replace(/\.astro$/, ''),
    }))
    .filter(({ path }) => !path.includes('['))
    .map((page) => ({ ...page, path: page.path.replace(/\/index$/, '/') }))
    .filter(({ path }) => path !== '/404' && !path.includes('/_'))
    .map((page) => ({
      files: [page.file],
      path: page.path.endsWith('/') ? page.path : `${page.path}/`,
    }));
}

export const GET: APIRoute = () => {
  const pages = [
    ...staticPages(),
    ...mortgagePages.map((page) => ({
      path: `/mortgage/${page.slug}/`,
      files: ['src/pages/mortgage/[slug].astro', 'src/lib/mortgage-pages.ts'],
    })),
  ].sort((a, b) => a.path.localeCompare(b.path));

  const body = pages
    .map(
      (page) =>
        `  <url>\n    <loc>${escapeXml(absolute(page.path))}</loc>\n    <lastmod>${lastModified(page.files)}</lastmod>\n  </url>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
