/*
 * Генерация растровых иконок и OG-картинки из SVG через sharp.
 * Запуск: npm run icons. Результат лежит в public/ и коммитится.
 */
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

const BARS = `
  <rect x="2" y="4" width="6" height="22" rx="1.5" fill="#136c4b"/>
  <rect x="2" y="4" width="6" height="14" rx="1.5" fill="#a8621a"/>
  <rect x="11" y="9" width="6" height="17" rx="1.5" fill="#136c4b"/>
  <rect x="11" y="9" width="6" height="7" rx="1.5" fill="#a8621a"/>
  <rect x="20" y="14" width="6" height="12" rx="1.5" fill="#136c4b"/>
  <rect x="20" y="14" width="6" height="2.5" rx="1.25" fill="#a8621a"/>`;

const icon = (size, padding, background) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${background ? `<rect width="${size}" height="${size}" fill="${background}" rx="${size * 0.18}"/>` : ''}
  <g transform="translate(${padding} ${padding}) scale(${(size - padding * 2) / 28})">${BARS}</g>
</svg>`;

const og = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f7f7f5"/>
  <g transform="translate(96 120) scale(4.2)">${BARS}</g>
  <text x="96" y="330" font-family="Helvetica, Arial, sans-serif" font-size="72" font-weight="700" fill="#161a24" letter-spacing="-2">Amortize</text>
  <text x="96" y="400" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#5b6270">Калькулятор кредитов с графиком платежей</text>
  <text x="96" y="450" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#5b6270">по банковской методике</text>
  <rect x="96" y="520" width="700" height="10" rx="4" fill="#d9dbd6"/>
  <rect x="96" y="520" width="265" height="10" rx="4" fill="#136c4b"/>
  <rect x="361" y="520" width="435" height="10" rx="4" fill="#a8621a"/>
</svg>`;

const render = async (svg, file, width) => {
  await sharp(Buffer.from(svg)).resize(width).png().toFile(`public/${file}`);
  console.log('✓', file);
};

await render(icon(512, 64, null), 'icon-512.png', 512);
await render(icon(512, 112, '#ffffff'), 'icon-maskable-512.png', 512);
await render(icon(192, 24, null), 'icon-192.png', 192);
await render(icon(180, 24, '#ffffff'), 'apple-touch-icon.png', 180);
await render(og, 'og.png', 1200);

/* favicon.ico: один 32×32 PNG, завёрнутый в ICO-контейнер */
const png32 = await sharp(Buffer.from(icon(32, 2, null)))
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
