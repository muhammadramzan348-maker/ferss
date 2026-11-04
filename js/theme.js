// Light / Dark mode. The choice is saved in localStorage ('theme'); first run follows the phone's setting.
export const THEMES = ['light', 'dark'];
export const systemTheme = (win) => (win?.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light');
export function getTheme({ storage, win } = {}) {
  const t = storage?.getItem('theme');
  return THEMES.includes(t) ? t : systemTheme(win);
}
export function applyTheme(theme, doc) {
  doc.documentElement.setAttribute('data-theme', theme);
  doc.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#0f1a2c' : '#12263f');
}
export function setTheme(theme, env) {
  if (!THEMES.includes(theme)) throw new Error(`Unknown theme ${theme}`);
  env.storage.setItem('theme', theme); applyTheme(theme, env.doc); return theme;
}
export const toggleTheme = (env) => setTheme(getTheme(env) === 'dark' ? 'light' : 'dark', env);
export const browserEnv = () => ({ storage: window.localStorage, doc: document, win: window });
