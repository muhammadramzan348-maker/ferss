import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { DriveBackup, DriveError, BACKUP_NAME } from '../js/gdrive.js';
import { getTheme, setTheme, toggleTheme, applyTheme, systemTheme } from '../js/theme.js';
import { S } from '../js/ui/ctx.js';
import { startGoogleBackup, startGoogleRestore, restoreFromDrive } from '../js/ui/backup_actions.js';
import { mkShop, seed } from './helpers.js';
import { installFakeDom } from './fake-dom.js';

const dom = installFakeDom();

/** In-memory imitation of the Google Drive v3 endpoints the app uses (create, update/PATCH, list, download, delete). */
function mockDrive({ token = 'good' } = {}) {
  const files = new Map(); let n = 0, clock = 0; const calls = [];
  const resp = (status, body) => ({ ok: status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const parse = (opts) => {
    const b = /boundary=(.+)$/.exec(opts.headers['Content-Type'])[1];
    const parts = opts.body.split(`--${b}`).filter((x) => x.trim() && x.trim() !== '--');
    return { meta: JSON.parse(parts[0].split('\r\n\r\n')[1].trim()), content: parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '') };
  };
  const stamp = () => new Date(Date.UTC(2026, 10, 1, 8, ++clock)).toISOString();
  const view = ({ id, name, createdTime, modifiedTime, content }) => ({ id, name, createdTime, modifiedTime, size: String(content.length) });
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url), method = opts.method || 'GET'; calls.push(`${method} ${u.pathname}`);
    if (opts.headers?.Authorization !== `Bearer ${token}`) return resp(401, { error: { message: 'Invalid Credentials' } });
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const { meta, content } = parse(opts), id = `f${++n}`, t = stamp();
      files.set(id, { id, name: meta.name, createdTime: t, modifiedTime: t, appProperties: meta.appProperties, content });
      return resp(200, view(files.get(id)));
    }
    let m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (m && method === 'PATCH') {
      const f = files.get(m[1]); if (!f) return resp(404, { error: { message: 'File not found' } });
      const { meta, content } = parse(opts); f.content = content; f.name = meta.name; f.modifiedTime = stamp(); return resp(200, view(f));
    }
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      assert.match(decodeURIComponent(u.searchParams.get('q')), /ramzan-shop/);
      const list = [...files.values()].filter((f) => f.appProperties?.app === 'ramzan-shop').sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
      return resp(200, { files: list.map(view) });
    }
    m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (m && method === 'DELETE') { files.delete(m[1]); return resp(204, ''); }
    if (m && u.searchParams.get('alt') === 'media') return files.has(m[1]) ? resp(200, files.get(m[1]).content) : resp(404, { error: { message: 'not found' } });
    return resp(404, {});
  };
  const add = (name, content = '{}', app = 'ramzan-shop') => { const id = `f${++n}`, t = stamp(); files.set(id, { id, name, createdTime: t, modifiedTime: t, appProperties: { app }, content }); return id; };
  return { fetchFn, files, calls, add };
}

test('the backup file has one fixed name', () => assert.equal(BACKUP_NAME, 'ramzan_store_backup.json'));

test('first backup creates ramzan_store_backup.json; the app never sees other files in Drive', async () => {
  const srv = mockDrive(); srv.files.set('x', { id: 'x', name: 'holiday.jpg', createdTime: '2020-01-01T00:00:00Z', modifiedTime: '2020-01-01T00:00:00Z', content: 'zzz' });
  const shop = await mkShop(); const { paris, ali } = await seed(shop);
  await shop.postSale({ customerId: ali.id, lines: [{ productId: paris.id, amount: 1500 }], payments: [{ account: 'cash', amount: 1000 }] });
  const drive = new DriveBackup({ token: 'good', fetchFn: srv.fetchFn });
  const file = await drive.backup(await shop.exportAll());
  assert.equal(file.name, BACKUP_NAME); assert.equal(file.mode, 'created');
  assert.deepEqual((await drive.list()).map((f) => f.name), [BACKUP_NAME]);
  const phone2 = await mkShop(); S.shop = phone2;                                    // restore onto a brand-new phone
  await phone2.importAll(await drive.fetchBackup(file.id));
  assert.equal(phone2.stockOf(paris.id).qty, 9750); assert.equal(phone2.accountBalance('cash'), 1000);
  assert.equal(phone2.balance('customer', ali.id), 500); assert.equal((await phone2.sales()).length, 1);
});

test('every later backup OVERWRITES the same file: same id, no duplicates, fresh content', async () => {
  const srv = mockDrive(), shop = await mkShop(); const { paris } = await seed(shop);
  const drive = new DriveBackup({ token: 'good', fetchFn: srv.fetchFn });
  const first = await drive.backup(await shop.exportAll());
  await shop.postSale({ lines: [{ productId: paris.id, amount: 3000 }], payments: [{ account: 'cash', amount: 3000 }] });
  const second = await drive.backup(await shop.exportAll());
  const third = await drive.backup(await shop.exportAll());
  assert.equal(second.mode, 'updated'); assert.equal(third.mode, 'updated');
  assert.equal(second.id, first.id); assert.equal(third.id, first.id);
  assert.equal(srv.files.size, 1);                                                    // still ONE file in Drive
  assert.equal(srv.calls.filter((c) => c === 'POST /upload/drive/v3/files').length, 1); // created only once
  assert.equal(srv.calls.filter((c) => c.startsWith('PATCH')).length, 2);              // updated twice
  const saved = JSON.parse(srv.files.get(first.id).content);
  assert.equal(saved.data.sales.length, 1);                                           // contains the newest data
  assert.ok(Date.parse(third.modifiedTime) > Date.parse(first.modifiedTime));
});

test('old dated backups and accidental duplicates are cleaned up; other apps\' files are untouched', async () => {
  const srv = mockDrive(), shop = await mkShop(); await seed(shop);
  const legacy1 = srv.add('Ramzan-Store-Backup-2026-10-01_1000.json'), legacy2 = srv.add('Ramzan-Store-Backup-2026-10-02_1000.json');
  const dup = srv.add(BACKUP_NAME, '{"old":1}'); const newest = srv.add(BACKUP_NAME, '{"older":2}');
  const other = srv.add('notes.json', '{}', 'some-other-app');                          // not ours: invisible and never deleted
  const drive = new DriveBackup({ token: 'good', fetchFn: srv.fetchFn });
  const file = await drive.backup(await shop.exportAll());
  assert.equal(file.id, newest);                                                      // updated the most recently modified one
  assert.deepEqual([...srv.files.keys()].sort(), [newest, other].sort());
  for (const gone of [legacy1, legacy2, dup]) assert.ok(!srv.files.has(gone));
  assert.deepEqual((await drive.list()).map((f) => f.id), [newest]);                 // restore would show exactly one backup
});

test('if the file was deleted in Drive meanwhile (404), a fresh one is created', async () => {
  const srv = mockDrive(), shop = await mkShop(); await seed(shop);
  const drive = new DriveBackup({ token: 'good', fetchFn: srv.fetchFn });
  const first = await drive.backup(await shop.exportAll());
  const realFetch = srv.fetchFn; let patched = false;
  drive.f = async (url, opts) => { if (!patched && opts?.method === 'PATCH') { patched = true; srv.files.delete(first.id); } return realFetch(url, opts); };
  const again = await drive.backup(await shop.exportAll());
  assert.equal(again.mode, 'created'); assert.equal(srv.files.size, 1); assert.equal([...srv.files.values()][0].name, BACKUP_NAME);
});

test('clear errors: expired sign-in, Drive API off, file that is not a backup', async () => {
  const srv = mockDrive();
  await assert.rejects(new DriveBackup({ token: 'bad', fetchFn: srv.fetchFn }).list(), (e) => e instanceof DriveError && e.status === 401 && /expired/.test(e.message));
  const f403 = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'Drive API has not been used' } }), text: async () => '' });
  await assert.rejects(new DriveBackup({ token: 't', fetchFn: f403 }).list(), (e) => e.status === 403 && /Drive API/.test(e.message));
  const drive = new DriveBackup({ token: 'good', fetchFn: srv.fetchFn });
  const a = srv.add('whatever.json', JSON.stringify({ hello: 'world' })), b = srv.add('y.json', 'not json at all');
  await assert.rejects(drive.fetchBackup(a), /not a Ramzan Store backup/);
  await assert.rejects(drive.fetchBackup(b), /not a valid backup/);
});

test('startGoogleBackup / startGoogleRestore: backup twice, restore shows ONE latest backup', async () => {
  const srv = mockDrive(), shop = await mkShop(); const { paris } = await seed(shop);
  S.shop = shop; S.lang = 'en';
  const api = new DriveBackup({ token: 'good', fetchFn: srv.fetchFn });
  dom.reset(); await startGoogleBackup(); assert.equal(srv.calls.length, 0);          // no Client ID -> nothing sent
  assert.ok(dom.toasts.some((x) => x.error && /Client ID/.test(x.text)));
  dom.reset(); const f1 = await startGoogleBackup(api);
  assert.equal(f1.mode, 'created'); assert.ok(Number(localStorage.getItem('lastDriveBackup')) > 0);
  await shop.postSale({ lines: [{ productId: paris.id, amount: 3000 }], payments: [{ account: 'cash', amount: 3000 }] });
  const f2 = await startGoogleBackup(api);
  assert.equal(f2.mode, 'updated'); assert.equal(f2.id, f1.id); assert.ok(dom.toasts.some((x) => /updated/i.test(x.text)));
  await shop.postSale({ lines: [{ productId: paris.id, amount: 1500 }], payments: [{ account: 'cash', amount: 1500 }] });   // newer than the backup
  const files = await startGoogleRestore(api);
  assert.equal(files.length, 1); assert.ok(dom.sheets.some((h) => h.includes('gdPick') && h.includes(BACKUP_NAME.slice(0, 5))));
  const { restored, safety } = await restoreFromDrive(files[0].id, api);
  assert.ok(restored > 0); assert.equal(shop.stockOf(paris.id).qty, 9500);           // = the state at the 2nd (latest) backup
  assert.equal(safety.data.sales.length, 2);
  shop.role = 'salesman'; dom.reset(); assert.equal(await startGoogleBackup(api), undefined); assert.ok(dom.toasts.some((x) => x.error));
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
