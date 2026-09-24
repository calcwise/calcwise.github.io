# amortize.by

Free loan calculators for Belarus (and Russia): mortgage schedule today, housing cooperative
later. All user-facing copy is Russian; code and this file are English. No currency is shown
anywhere — only amounts, because the math does not depend on currency.

## Stack

Astro 7, TypeScript strict, npm, Node 22.12+. Static build, no adapter, no UI framework. Runtime
dependencies: `big.js` (exact money arithmetic) and `sharp` (icons at build time only).

| Command           | What it does                                          |
| ----------------- | ----------------------------------------------------- |
| `npm run dev`     | dev server on :4321                                   |
| `npm run build`   | static build into `dist/`                             |
| `npm run preview` | serve `dist/`                                         |
| `npm run check`   | `astro check` (types and templates)                   |
| `npm test`        | `node --test` over `src/lib/**/*.test.ts`             |
| `npm run lint`    | ESLint with `--fix`; architecture rules live here     |
| `npm run format`  | Prettier                                              |
| `npm run icons`   | regenerate PNG icons, favicon.ico and og.png from SVG |

Before finishing any task run `npm run build && npm run check && npm run lint && npm test` —
all four must be green.

## Structure

```
src/
├── pages/            file-based routes + sitemap.xml.ts
│   ├── mortgage/     index (calculator), [slug] (intent pages), compare/
│   ├── cooperative/  placeholder — the section is planned, owner will provide the model
│   └── guide/        formulas and methodology (Article + FAQ markup)
├── components/
│   ├── atoms/        container, button, logo
│   ├── molecules/    field, segmented, stat-list, figure, legend, years-table
│   ├── organisms/    header, tab-bar, footer, page-intro, prose, faq, disclaimer,
│   │                 calculator-form, results-summary, actions-menu, analysis,
│   │                 schedule-table, mortgage-calculator (composes the above)
│   └── templates/    base-layout.astro — <head>, header, footer, tab bar, JSON-LD
├── lib/              all logic as plain TypeScript (no astro imports)
│   ├── mortgage/     schedule engine: types, money, validate, schedule, analysis + tests
│   ├── calculator-ui.ts / compare-ui.ts   DOM behaviour, wired via <script> in components
│   ├── url-state.ts  calculator state ⇄ query string (shareable links)
│   ├── charts.ts     SVG charts as strings
│   ├── mortgage-pages.ts  content of /mortgage/<slug>/ intent pages
│   ├── schedule-render.ts HTML strings for results, shared by build-time prerender and client
│   └── seo.ts, menu.ts, format.ts, csv.ts, dom.ts, lastmod.ts, speculation.ts
├── styles/           one file per shared component (controls, segmented, rows, tables,
│                     stats, legend, charts, menu, results, print) + base.css
└── config/           site.ts, tokens.css, fonts.css, global.css (imports styles/* in order)

public/               fonts (Golos Text), icons, robots.txt, manifest, .htaccess
reference/            read-only: cooperative draft and the standalone v1 calculator
.agents/skills/       web-quality skills (seo, a11y, CWV, performance, best-practices, audit)
```

## Architecture rules

**Imports only go down:** `atoms ← molecules ← organisms ← templates ← pages`. Any level may
use `lib/` and `config/`. ESLint enforces this.

**Logic stays framework-free.** `lib/*.ts` must not import `astro`/`astro:*` (ESLint).
`.astro` files are thin: markup, classes, data attributes. Interactivity is `init*(root)` in
`lib/`, called from a `<script>` in the component. Inside `lib/` use relative imports with
`.ts` extension so `node --test` runs the files directly (erasable TS only: no enums, no
parameter properties).

## Calculation methodology (do not change casually)

Bank-style: monthly rate = annual / 12; interest on the opening balance; the schedule is
computed with full precision in `big.js` and **rounded to kopecks only for display**. This is
what makes totals match bank statements (verified: 250 000 at 15.4% for 239 months with a
12-month grace period → overpayment 559 439,55). Payment is recomputed on the remaining
balance and remaining paying months after: a rate-period change, the end of a grace period,
a prepayment in `payment` mode. `term`-mode prepayments keep the payment; the loan simply ends
earlier. Tests in `src/lib/mortgage/schedule.test.ts` pin all of this — extend them with any
new behaviour.

## Styling

Every colour, size and spacing comes from `src/config/tokens.css`; raw values in components
are forbidden. Colour tokens are declared twice: `light-dark()` in `:root` and a flat light
value inside `@supports not (color: light-dark(…))`. Theme follows `prefers-color-scheme`;
no switcher, nothing in localStorage except the last calculator state.

Two data colours carry meaning everywhere (summary, tables, charts, logo): `--color-principal`
(debt) and `--color-interest` (interest); `--color-prepay` marks prepayments. Numbers use
`.num` (tabular figures). BEM inside components. Breakpoints 360 / 768 / 1024 / 1440,
mobile-first, touch targets ≥ 44px. Navigation: bottom tab bar below 1024px, header menu from
1024px, items shared from `lib/menu.ts`. `[hidden]` always wins over component `display`.

Shared CSS lives in `src/styles/*.css`, one file per component, imported from
`config/global.css` in order (base → controls → segmented → rows → tables → stats → legend →
charts → menu → results → print). These classes are also created by `lib/*-ui.ts` and
`lib/schedule-render.ts`, so markup and CSS change together. Sizes: `--control-height` (3rem)
for fields, buttons and switches, `--tap-min` (2.75rem) for every touch target, hover/focus
transitions only via `--transition-ui`.

## SEO

URLs are English, nested, with a trailing slash (`trailingSlash: 'always'`,
`build.format: 'directory'`). Every page gets unique title/description, canonical, Open Graph
and JSON-LD through `BaseLayout` props only. `title` is the H1; `<title>` is built by
`buildTitle` (brand suffix only when ≤ 60 chars); descriptions are clamped to 160 chars.
JSON-LD only via `lib/seo.ts` generators: WebApplication + BreadcrumbList on calculator
pages, FAQPage only where the questions are visible (`/faq/`, `/guide/`), Article on the guide.
Breadcrumbs exist only in markup. Calculator pages prerender the results of their initial state
at build time (same HTML strings as the client uses), so there is no layout shift on load.

Intent pages (`/mortgage/annuity/`, `/differentiated/`, `/early-repayment/`,
`/grace-period/`, `/preferential-rate/`) are data in `lib/mortgage-pages.ts`: same calculator,
different preset and copy. Adding a page there adds it to the sitemap and footer automatically.

Calculator state lives in the query string (`lib/url-state.ts`) so results are shareable;
`history.replaceState` keeps the canonical path unchanged.

`public/.htaccess` handles https/www redirects, trailing slashes, security headers and cache.
It is the only redirect map: renaming a page means adding a 301 there.

## Content rules

Every calculator page shows the disclaimer that bank terms may differ (day-count, dates,
fees, insurance). There are no rate presets by the owner's decision. Write copy in plain, living
Russian: no bureaucratese, no SEO filler, sentence case, no ALL-CAPS labels. Comments in
Russian, only where code cannot speak for itself.

## Prohibitions

- `reference/` is read-only.
- No new dependencies without a real need; UI libraries and chart libraries are banned
  (charts are hand-written SVG in `lib/charts.ts`).
- Do not add analytics without the prerender guard described in `TODO.md`.
