// Google Drive backup & restore. Uses the "drive.file" scope: the app can only see files IT created
// (never the rest of your Drive). No server in between: the browser talks to Google directly.
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com';

export class DriveError extends Error { constructor(message, status) { super(message); this.status = status; } }

/** The one and only backup file. Every backup updates this same file (no duplicates in Drive). */
export const BACKUP_NAME = 'ramzan_store_backup.json';
const LEGACY = /^Ramzan-Store-Backup-.*\.json$/;           // dated files made by older versions of the app

export class DriveBackup {
  constructor({ token, fetchFn = (...a) => globalThis.fetch(...a) }) { this.token = token; this.f = fetchFn; }

  async _req(url, opts = {}) {
    const r = await this.f(url, { ...opts, headers: { Authorization: `Bearer ${this.token}`, ...(opts.headers || {}) } });
    if (r.ok) return r;
    let detail = ''; try { detail = (await r.json()).error?.message || ''; } catch { /* no body */ }
    if (r.status === 401) throw new DriveError('Google sign-in expired. Please try again.', 401);
    if (r.status === 403) throw new DriveError(`Google refused access. Make sure the Drive API is enabled. ${detail}`.trim(), 403);
    throw new DriveError(`Google Drive error ${r.status}. ${detail}`.trim(), r.status);
  }

  /** Backup files created by this app, most recently updated first. */
  async list() {
    const q = encodeURIComponent("appProperties has { key='app' and value='ramzan-shop' } and trashed=false");
    const r = await this._req(`${API}/drive/v3/files?q=${q}&orderBy=modifiedTime%20desc&pageSize=50&fields=files(id,name,createdTime,modifiedTime,size)`);
    return (await r.json()).files || [];
  }
  _multipart(meta, text) {
    const b = `ramzan${Math.random().toString(36).slice(2)}`;
    return { type: `multipart/related; boundary=${b}`, body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${b}--` };
  }
  /** create a new file */
  async create(text) {
    const m = this._multipart({ name: BACKUP_NAME, mimeType: 'application/json', description: 'Ramzan Electric Store & Hardware backup', appProperties: { app: 'ramzan-shop' } }, text);
    return (await this._req(`${API}/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,modifiedTime,size`, { method: 'POST', headers: { 'Content-Type': m.type }, body: m.body })).json();
  }
  /** overwrite the content of an existing file (same file id, same name) */
  async update(id, text) {
    const m = this._multipart({ name: BACKUP_NAME, mimeType: 'application/json', appProperties: { app: 'ramzan-shop' } }, text);
    return (await this._req(`${API}/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=multipart&fields=id,name,createdTime,modifiedTime,size`, { method: 'PATCH', headers: { 'Content-Type': m.type }, body: m.body })).json();
  }
  async download(id) { return (await this._req(`${API}/drive/v3/files/${encodeURIComponent(id)}?alt=media`)).text(); }
  async remove(id) { await this._req(`${API}/drive/v3/files/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  /**
   * Save a backup. If ramzan_store_backup.json already exists in Drive it is UPDATED in place;
   * otherwise it is created. Extra copies (duplicates / old dated files) are removed afterwards,
   * so a restore always shows a single, latest backup. Returns { ...file, mode: 'created' | 'updated' }.
   */
  async backup(data) {
    const text = JSON.stringify(data), files = await this.list();
    let file = null, mode = 'created';
    for (const f of files.filter((x) => x.name === BACKUP_NAME)) {
      try { file = await this.update(f.id, text); mode = 'updated'; break; }
      catch (e) { if (e.status !== 404) throw e; }               // file vanished meanwhile -> try the next one / create
    }
    if (!file) file = await this.create(text);
    for (const f of files) {                                      // tidy up (best effort; the backup itself is already safe)
      if (f.id !== file.id && (f.name === BACKUP_NAME || LEGACY.test(f.name))) { try { await this.remove(f.id); } catch { /* ignore */ } }
    }
    return { ...file, mode };
  }
  /** Download and validate a backup file. */
  async fetchBackup(id) {
    let json; try { json = JSON.parse(await this.download(id)); } catch { throw new DriveError('That file is not a valid backup.', 0); }
    if (json?.app !== 'ramzan-shop' || !json.data) throw new DriveError('That file is not a Ramzan Store backup.', 0);
    return json;
  }
}

// ----- browser only: Google Identity Services token (popup, asks the owner to allow Drive access) -----
let cached = null;
function loadGis() {
  return new Promise((res, rej) => {
    if (globalThis.google?.accounts?.oauth2) return res();
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('Could not load Google sign-in. Check the internet connection.'));
    document.head.appendChild(s);
  });
}
export async function getAccessToken(clientId) {
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  await loadGis();
  return new Promise((res, rej) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: DRIVE_SCOPE,
      callback: (r) => { if (r.error) return rej(new Error(r.error_description || r.error)); cached = { token: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 }; res(r.access_token); },
      error_callback: (e) => rej(new Error(e?.type === 'popup_closed' ? 'Google sign-in was closed.' : (e?.message || e?.type || 'Google sign-in failed'))),
    });
    client.requestAccessToken({ prompt: cached ? '' : 'consent' });
  });
}
