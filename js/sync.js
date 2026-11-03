// Optional Supabase sync. Local data is always the working copy; sync failures never lose data.
// Append-only rows (stock movements, khata, cash) merge as a union, so two phones selling
// offline never overwrite each other. Editable records use "latest edit wins".
export class Sync {
  constructor(shop, { fetchFn = (...a) => globalThis.fetch(...a), onlineCheck = () => true } = {}) {
    this.shop = shop; this.store = shop.store; this.f = fetchFn; this.running = false; this.onlineCheck = onlineCheck;
  }
  async _meta(id) { return (await this.store.get('meta', id)) || { id }; }
  async _put(o) { await this.store.batch([{ col: 'meta', obj: o }]); }

  async config() { return this._meta('syncConfig'); }
  async saveConfig({ url, anon, email }) {
    await this._put({ id: 'syncConfig', url: String(url || '').trim().replace(/\/+$/, ''), anon: String(anon || '').trim(), email: email || '' });
  }
  async signedIn() { return !!(await this._meta('session')).refresh; }
  async signOut() { await this.store.batch([{ col: 'meta', del: 'session' }]); }

  async _auth(grant, body) {
    const c = await this.config();
    if (!c.url || !c.anon) throw new Error('Enter the Supabase URL and anon key first');
    const r = await this.f(`${c.url}/auth/v1/token?grant_type=${grant}`, { method: 'POST', headers: { apikey: c.anon, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Sign-in failed (${r.status})`);
    const j = await r.json();
    await this._put({ id: 'session', access: j.access_token, refresh: j.refresh_token, userId: j.user?.id });
    return j;
  }
  signIn(email, password) { return this._auth('password', { email, password }); }

  async syncNow() {
    if (this.running) return { pushed: 0, pulled: 0, error: 'Sync already running' };
    this.running = true;
    const res = { pushed: 0, pulled: 0, error: null };
    try {
      if (!this.onlineCheck()) throw new Error('Offline');
      const c = await this.config(), s = await this._meta('session');
      if (!s.refresh) throw new Error('Sign in to cloud sync first');
      const j = await this._auth('refresh_token', { refresh_token: s.refresh });
      const h = { apikey: c.anon, Authorization: `Bearer ${j.access_token}`, 'Content-Type': 'application/json' };
      res.pushed = await this._push(c.url, h, j.user?.id || s.userId);
      res.pulled = await this._pull(c.url, h);
      await this._put({ id: 'lastSync', at: this.shop.now() });
    } catch (e) { res.error = e.message || String(e); } finally { this.running = false; }
    return res;
  }

  async _push(url, h, owner) {
    let total = 0;
    for (;;) {
      const batch = (await this.store.all('outbox')).sort((a, b) => a.at - b.at).slice(0, 100);
      if (!batch.length) return total;
      const rows = [];
      for (const o of batch) {
        const doc = await this.store.get(o.col, o.rid);
        if (doc) rows.push({ owner_id: owner, col: o.col, rid: o.rid, device: this.shop.deviceId, payload: doc });
      }
      if (rows.length) {
        const r = await this.f(`${url}/rest/v1/sync_records?on_conflict=owner_id,col,rid`, { method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
        if (!r.ok) throw new Error(`Upload failed (${r.status})`);
        total += rows.length;
      }
      await this.store.batch(batch.map((o) => ({ col: 'outbox', del: o.id })));
    }
  }

  async _pull(url, h) {
    let cursor = (await this._meta('cursor')).rev || 0, n = 0;
    for (;;) {
      const q = `select=col,rid,payload,rev&rev=gt.${cursor}&device=neq.${this.shop.deviceId}&order=rev.asc&limit=500`;
      const r = await this.f(`${url}/rest/v1/sync_records?${q}`, { headers: h });
      if (!r.ok) throw new Error(`Download failed (${r.status})`);
      const rows = await r.json();
      if (!rows.length) return n;
      for (const x of rows) if (await this.shop.applyRemote(x.col, x.payload)) n++;
      cursor = rows[rows.length - 1].rev;
      await this._put({ id: 'cursor', rev: cursor });
      if (rows.length < 500) return n;
    }
  }
}
// Automatically add Google Drive buttons to the app screen
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (!document.getElementById('btnGoogleBackup')) {
            const container = document.createElement('div');
            container.style.cssText = "text-align: center; margin: 15px; padding: 10px; background: #fff; border-radius: 8px;";
            container.innerHTML = `
                <button onclick="startGoogleBackup()" style="background: #4285F4; color: white; padding: 10px 15px; border: none; border-radius: 5px; font-weight: bold; cursor: pointer; margin-right: 5px;">Backup to Drive</button>
                <button onclick="startGoogleRestore()" style="background: #34A853; color: white; padding: 10px 15px; border: none; border-radius: 5px; font-weight: bold; cursor: pointer;">Restore from Drive</button>
                <p id="syncStatus" style="font-size: 12px; margin-top: 5px; font-weight: bold;"></p>
            `;
            const target = document.querySelector('#app') || document.body;
            target.insertBefore(container, target.firstChild);
        }
    }, 1000);
});
