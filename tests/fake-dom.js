// A tiny fake browser so real UI actions (acts.lineSave, acts.khSave, ...) can run in Node tests.
export function installFakeDom() {
  const reg = new Map(), toasts = [], sheets = [], downloads = [];
  const el = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, remove() {}, click() {}, textContent: '', _h: '',
    set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, get firstElementChild() { return el(); }, setAttribute() {} });
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.document = {
    createElement: () => { const e = el(); Object.defineProperty(e, 'className', { set(v) { e._c = v; }, get() { return e._c; } });
      Object.defineProperty(e, 'innerHTML', { set(v) { e._h = v; if (e.id === 'sheet' || /class="sheet/.test(v)) sheets.push(v); }, get() { return e._h; } }); return e; },
    body: { appendChild(e) { if (e.className?.startsWith('toast')) toasts.push({ text: e.textContent, error: /err/.test(e.className) }); } },
    head: { appendChild() {} }, getElementById: () => null, querySelector: (s) => reg.get(s) || null, querySelectorAll: () => [],
    documentElement: { setAttribute(k, v) { globalThis.document.documentElement[k] = v; } },
  };
  globalThis.window = { dispatchEvent() {}, matchMedia: () => ({ matches: false }), addEventListener() {}, confirm: () => true, prompt: () => 'RESET', open() {} };
  globalThis.URL.createObjectURL = () => 'blob:x';
  reg.set('#lineResult', { textContent: '' });
  return { reg, toasts, sheets, downloads, reset() { toasts.length = 0; sheets.length = 0; } };
}
/** form stub: values are plain strings */
export const form = (dataset, vals) => ({ dataset, ...Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, { value: v }])) });
