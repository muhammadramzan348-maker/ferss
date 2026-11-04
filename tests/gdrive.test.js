import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { DriveBackup, DriveError, backupName } from '../js/gdrive.js';
import { getTheme, setTheme, toggleTheme, applyTheme, systemTheme } from '../js/theme.js';
import { S } from '../js/ui/ctx.js';
import { startGoogleBackup, startGoogleRestore, restoreFromDrive } from '../js/ui/backup_actions.js';
import { mkShop, seed } from './helpers.js';
import { installFakeDom } from './fake-dom.js';

const dom = installFakeDom();

/** In-memory imitation of the Google Drive v3 endpoints the app uses. */
function mockDrive({ token = 'good' } = {}) {
  const files = new Map(); let n = 0; const calls = [];
  const resp = (status, body) => ({ ok: status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url), method = opts.method || 'GET'; calls.push(`${method} ${u.pathname}`);
    if (opts.headers?.Authorization !== `Bearer ${token}`) return resp(401, { error: { message: 'Invalid Credentials' } });
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const b = /boundary=(.+)$/.exec(opts.headers['Content-Type'])[1];
      const parts = opts.body.split(`--${b}`).filter((x) => x.trim() && x.trim() !== '--');
      const meta = JSON.parse(parts[0].split('\r\n\r\n')[1].trim()), content = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
      const id = `f${++n}`; const createdTime = new Date(Date.UTC(2026, 10, 1, 8, n)).toISOString();
      files.set(id, { id, name: meta.name, createdTime, appProperties: meta.appProperties, content, size: String(content.length) });
      return resp(200, { id, name: meta.name, createdTime, size: String(content.length) });
    }
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      assert.match(decodeURIComponent(u.searchParams.get('q')), /ramzan-shop/);
      const list = [...files.values()].filter((f) => f.appProperties?.app === 'ramzan-shop').sort((a, b) => b.createdTime.localeCompare(a.createdTime));
      return resp(200, { files: list.map(({ id, name, createdTime, size }) => ({ id, name, createdTime, size })) });
    }
    const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (m && method === 'DELETE') { files.delete(m[1]); return resp(204, ''); }
    if (m && u.searchParams.get('alt') === 'media') return files.has(m[1]) ? resp(200, files.get(m[1]).content) : resp(404, { error: { message: 'not found' } });
    return resp(404, {});
  };
  return { fetchFn, files, calls, stranger: () => files.set('x', { id: 'x', name: 'holiday.jpg', createdTime: '2020-01-01T00:00:00Z', content: 'zzz' }) };
}

test('backup file name uses Pakistan time', () => {
  assert.equal(backupName(Date.UTC(2026, 10, 3, 9, 5)), 'Ramzan-Store-Backup-2026-11-03_1405.json');
});

test('backup uploads a complete, restorable copy; the app only lists ITS OWN files', async () => {
  const srv = mockDrive(); srv.stranger();
  const shop = await mkShop(); const { paris, ali } = await seed(shop);
  await shop.postSale({ customerId: ali.id, lines: [{ productId: paris.id, amount: 1500 }], payments: [{ account: 'cash', amount: 1000 }] });
  const drive = new DriveBackup({ token: 'good', fetchFn: srv.fetchFn });
  const file = await drive.backup(await shop.exportAll(), Date.UTC(2026, 10, 3, 9, 5));
  assert.match(file.name, /^Ramzan-Store-Backup-2026-11-03_1405\.json$/);
  const listed = await drive.list();
  assert.deepEqual(listed.map((f) => f.name), [file.name]);                         // 'holiday.jpg' is not visible to the app
  // restore onto a brand-new phone
  const phone2 = await mkShop(); S.shop = phone2;
  const json = await drive.fetchBackup(file.id);
  await phone2.importAll(json);
  assert.equal(phone2.stockOf(paris.id).qty, 9750); assert.equal(phone2.accountBalance('cash'), 1000);
  assert.equal(phone2.balance('customer', ali.id), 500); assert.equal((await phone2.sales()).length, 1);
});

test('only the newest N backups are kept', async () => {
  const srv = mockDrive(), shop = await mkShop(); await seed(shop);
  const drive = new DriveBackup({ token: 'good', fetchFn: srv.fetchFn, keep: 3 });
  for (let i = 0; i < 5; i++) await drive.backup(await shop.exportAll(), Date.UTC(2026, 10, 3, 9, i));
  const names = (await drive.list()).map((f) => f.name);
  assert.equal(names.length, 3); assert.match(names[0], /1404\.json$/);
});

test('clear errors: expired sign-in, Drive API off, file that is not a backup', async () => {
  const srv = mockDrive();
  await assert.rejects(new DriveBackup({ token: 'bad', fetchFn: srv.fetchFn }).list(), (e) => e instanceof DriveError && e.status === 401 && /expired/.test(e.message));
  const f403 = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'Drive API has not been used' } }), text: async () => '' });
  await assert.rejects(new DriveBackup({ token: 't', fetchFn: f403 }).list(), (e) => e.status === 403 && /Drive API/.test(e.message));
  const drive = new DriveBackup({ token: 'good', fetchFn: srv.fetchFn });
  const up = await drive.upload('Ramzan-Store-Backup-x.json', JSON.stringify({ hello: 'world' }));
  await assert.rejects(drive.fetchBackup(up.id), /not a Ramzan Store backup/);
  const up2 = await drive.upload('y.json', 'not json at all');
  await assert.rejects(drive.fetchBackup(up2.id), /not a valid backup/);
});

test('startGoogleBackup / startGoogleRestore (the two UI entry points)', async () => {
  const srv = mockDrive(), shop = await mkShop(); const { paris } = await seed(shop);
  S.shop = shop; S.lang = 'en';
  const api = new DriveBackup({ token: 'good', fetchFn: srv.fetchFn });
  // no Client ID configured -> friendly message, nothing sent
  dom.reset(); await startGoogleBackup(); assert.equal(srv.calls.length, 0);
  assert.ok(dom.toasts.some((x) => x.error && /Client ID/.test(x.text)));
  // backup
  dom.reset(); const file = await startGoogleBackup(api);
  assert.ok(file.id); assert.ok(Number(localStorage.getItem('lastDriveBackup')) > 0);
  assert.ok(dom.toasts.some((x) => /Backed up/.test(x.text)));
  // change data, then restore from Drive: the old state comes back
  await shop.postSale({ lines: [{ productId: paris.id, amount: 3000 }], payments: [{ account: 'cash', amount: 3000 }] });
  assert.equal(shop.stockOf(paris.id).qty, 9500);
  const files = await startGoogleRestore(api);
  assert.equal(files.length, 1); assert.ok(dom.sheets.some((h) => h.includes('gdPick')));
  const { restored, safety } = await restoreFromDrive(file.id, api);
  assert.ok(restored > 0); assert.equal(shop.stockOf(paris.id).qty, 10000); assert.equal(shop.accountBalance('cash'), 0);
  assert.equal(safety.data.sales.length, 1);                                       // safety copy of the data that was replaced
  // salesman cannot back up
  shop.role = 'salesman'; dom.reset(); const r = await startGoogleBackup(api);
  assert.equal(r, undefined); assert.ok(dom.toasts.some((x) => x.error));
});

test('Light / Dark mode is saved in localStorage and applied', () => {
  const mem = new Map(), attrs = {}, meta = { v: '', setAttribute(k, v) { this.v = v; } };
  const env = (dark = false) => ({ storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) },
    doc: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } }, querySelector: () => meta }, win: { matchMedia: () => ({ matches: dark }) } });
  assert.equal(getTheme(env(false)), 'light'); assert.equal(getTheme(env(true)), 'dark');   // first run follows the phone
  assert.equal(systemTheme(null), 'light');
  assert.equal(setTheme('dark', env()), 'dark');
  assert.equal(mem.get('theme'), 'dark'); assert.equal(attrs['data-theme'], 'dark'); assert.equal(meta.v, '#0f1a2c');
  assert.equal(getTheme(env(false)), 'dark');                                       // saved choice wins over the phone setting
  assert.equal(toggleTheme(env()), 'light'); assert.equal(mem.get('theme'), 'light'); assert.equal(meta.v, '#12263f');
  assert.equal(toggleTheme(env()), 'dark');
  assert.throws(() => setTheme('blue', env()));
  applyTheme('light', env().doc); assert.equal(attrs['data-theme'], 'light');
});

test('dark theme exists in the CSS and is applied before first paint', () => {
  const css = readFileSync('css/app.css', 'utf8'), html = readFileSync('index.html', 'utf8');
  assert.match(css, /\[data-theme=dark\]\{/);
  for (const v of ['--card', '--input', '--txt', '--bg', '--line']) assert.ok(css.split('[data-theme=dark]')[1].includes(v), v);
  assert.ok(!/\.sheet\{background:#fff/.test(css) && !/\.bottom\{[^}]*background:#fff/.test(css));
  assert.match(html, /data-theme/); assert.match(html, /localStorage\.getItem\("theme"\)/);
});

test('Supabase and cloud-sync code are completely gone', () => {
  const files = ['index.html', 'sw.js', ...walk('js'), ...walk('tools')];
  for (const f of files) assert.ok(!/supabase|sync_records|syncNow|S\.sync\b|applyRemote|outbox/i.test(readFileSync(f, 'utf8')), `${f} still mentions Supabase/sync`);
  assert.ok(!existsSync('js/sync.js') && !existsSync('supabase'));
  function walk(d) { return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`])); }
});
