/*
 * Генерация растровых иконок и OG-картинки из SVG через sharp.
 * Запуск: npm run icons. Результат лежит в public/ и коммитится.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * Текст на OG-картинке набран Golos Text — тем же шрифтом, что и сайт.
 * sharp на macOS берёт шрифты через CoreText и не видит файлы проекта, а
 * FreeType в его сборке не читает woff2, поэтому рядом лежат ttf-сабсеты и
 * fontconfig указывает только на них. Переменные окружения должны быть
 * выставлены до загрузки sharp — отсюда динамический import ниже.
 */
const fontsDir = new URL('./fonts/', import.meta.url).pathname;
const fcDir = join(tmpdir(), 'calcwise-fontconfig');
mkdirSync(fcDir, { recursive: true });
writeFileSync(
  join(fcDir, 'fonts.conf'),
  `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig><dir>${fontsDir}</dir><cachedir>${fcDir}</cachedir></fontconfig>\n`,
);
process.env.FONTCONFIG_FILE = join(fcDir, 'fonts.conf');
process.env.PANGOCAIRO_BACKEND = 'fontconfig';
const { default: sharp } = await import('sharp');

/*
 * Плитка иконки: диагональный градиент от зелёного (долг) к янтарному
 * (проценты) и белые столбики. Концы градиента ярче цветов темы:
 * прямая смесь #136c4b → #a8621a проходит через грязный оливковый.
 * Плитка одинаково читается на светлом и на тёмном рабочем столе.
 */
const TILE_FROM = '#1a8a5f';
const TILE_TO = '#e08a2a';
const TILE_BAR = '#ffffff';

const gradient = `
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${TILE_FROM}"/>
      <stop offset="1" stop-color="${TILE_TO}"/>
    </linearGradient>`;

/*
 * Столбики: долг — белый, проценты — полупрозрачный белый, сквозь который
 * просвечивает градиент. Пропорции те же, что в логотипе, поэтому и на
 * иконке, и на OG-картинке видно, как доля процентов тает с каждым платежом.
 */
const bars = `
  <rect x="2" y="4" width="6" height="22" rx="1.5" fill="${TILE_BAR}" fill-opacity="0.5"/>
  <rect x="2" y="12" width="6" height="14" rx="1.5" fill="${TILE_BAR}"/>
  <rect x="11" y="9" width="6" height="17" rx="1.5" fill="${TILE_BAR}" fill-opacity="0.5"/>
  <rect x="11" y="16" width="6" height="10" rx="1.5" fill="${TILE_BAR}"/>
  <rect x="20" y="14" width="6" height="12" rx="1.5" fill="${TILE_BAR}" fill-opacity="0.5"/>
  <rect x="20" y="16.5" width="6" height="9.5" rx="1.5" fill="${TILE_BAR}"/>`;

/*
 * rounded: скруглённые углы рисуем сами (favicon, обычные PWA-иконки).
 * Apple и maskable-иконки система обрезает по своей маске — им нужен
 * полный квадрат без прозрачных углов. Столбики занимают 24×22 из сетки
 * 28×28, поэтому знак сдвинут на единицу вверх — так он стоит по центру.
 */
const icon = (size, padding, { rounded = true } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>${gradient}</defs>
  <rect width="${size}" height="${size}" fill="url(#tile)"${rounded ? ` rx="${size * 0.22}"` : ''}/>
  <g transform="translate(${padding} ${padding}) scale(${(size - padding * 2) / 28}) translate(0 -1)">${bars}</g>
</svg>`;

/*
 * OG-картинка — та же плитка, растянутая на 1200×630: градиент несёт свой
 * фон, поэтому превью одинаково смотрится в светлом и тёмном чате. Знак
 * слева, словесная марка и слоган справа, всё выровнено по центру высоты.
 */
const og = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>${gradient}</defs>
  <rect width="1200" height="630" fill="url(#tile)"/>
  <g transform="translate(120 147) scale(12)">${bars}</g>
  <g font-family="Golos Text" fill="${TILE_BAR}">
    <text x="500" y="300" font-size="104" font-weight="700" letter-spacing="-2">Calcwise</text>
    <text x="500" y="372" font-size="34" fill-opacity="0.88">Калькулятор кредитов с графиком</text>
    <text x="500" y="420" font-size="34" fill-opacity="0.88">платежей по банковской методике</text>
  </g>
</svg>`;

const render = async (svg, file, width) => {
  await sharp(Buffer.from(svg)).resize(width).png().toFile(`public/${file}`);
  console.log('✓', file);
};

await render(icon(512, 88), 'icon-512.png', 512);
await render(icon(512, 112, { rounded: false }), 'icon-maskable-512.png', 512);
await render(icon(192, 33), 'icon-192.png', 192);
await render(icon(180, 31, { rounded: false }), 'apple-touch-icon.png', 180);
await render(og, 'og.png', 1200);

/* favicon.svg — та же плитка, что и в ICO, только векторная */
writeFileSync('public/favicon.svg', icon(28, 4).trim().replace(/\n\s*/g, '') + '\n');
console.log('✓ favicon.svg');

/* favicon.ico: один 32×32 PNG, завёрнутый в ICO-контейнер */
const png32 = await sharp(Buffer.from(icon(32, 5)))
  .png()
  .toBuffer();
const header = Buffer.alloc(6 + 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(32, 6);
header.writeUInt8(32, 7);
header.writeUInt8(0, 8);
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png32.length, 14);
header.writeUInt32LE(22, 18);
writeFileSync('public/favicon.ico', Buffer.concat([header, png32]));
console.log('✓ favicon.ico');
