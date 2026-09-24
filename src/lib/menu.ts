/*
 * Основная навигация одним списком: на широких экранах её показывает шапка,
 * на узких — нижний таб-бар. Разделы: калькуляторы (ипотека, кооператив) и справка.
 */

export type NavIcon = 'home' | 'mortgage' | 'cooperative' | 'guide';

export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
  /** Раздел ещё не запущен: показывается, но ведёт на страницу-анонс */
  soon?: boolean;
}

export const navItems: NavItem[] = [
  { label: 'Главная', href: '/', icon: 'home' },
  { label: 'Ипотека', href: '/mortgage/', icon: 'mortgage' },
  { label: 'Кооператив', href: '/cooperative/', icon: 'cooperative', soon: true },
  { label: 'Справка', href: '/guide/', icon: 'guide' },
];

/** Путь с завершающим слешем — сайт живёт на trailingSlash: 'always' */
export function normalizePath(pathname: string): string {
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

/** Раздел текущий, если путь начинается с его адреса. Главная — только точное совпадение */
export function isCurrentPath(href: string, currentPath: string): boolean {
  return href === '/' ? currentPath === '/' : currentPath.startsWith(href);
}
