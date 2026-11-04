// Google Drive backup & restore. Uses the "drive.file" scope: the app can only see files IT created
// (never the rest of your Drive). No server in between: the browser talks to Google directly.
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com';

export class DriveError extends Error { constructor(message, status) { super(message); this.status = status; } }

const p2 = (n) => String(n).padStart(2, '0');
/** Ramzan-Store-Backup-2026-11-03_1405.json (Pakistan time) */
export function backupName(ms = Date.now()) {
  const d = new Date(ms + 5 * 3600000);
  return `Ramzan-Store-Backup-${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}_${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}.json`;
}

export class DriveBackup {
  constructor({ token, fetchFn = (...a) => globalThis.fetch(...a), keep = 10 }) { this.token = token; this.f = fetchFn; this.keep = keep; }

  async _req(url, opts = {}) {
    const r = await this.f(url, { ...opts, headers: { Authorization: `Bearer ${this.token}`, ...(opts.headers || {}) } });
    if (r.ok) return r;
    let detail = ''; try { detail = (await r.json()).error?.message || ''; } catch { /* no body */ }
    if (r.status === 401) throw new DriveError('Google sign-in expired. Please try again.', 401);
    if (r.status === 403) throw new DriveError(`Google refused access. Make sure the Drive API is enabled. ${detail}`.trim(), 403);
    throw new DriveError(`Google Drive error ${r.status}. ${detail}`.trim(), r.status);
  }

  /** newest first */
  async list() {
    const q = encodeURIComponent("appProperties has { key='app' and value='ramzan-shop' } and trashed=false");
    const r = await this._req(`${API}/drive/v3/files?q=${q}&orderBy=createdTime%20desc&pageSize=50&fields=files(id,name,createdTime,size)`);
    return (await r.json()).files || [];
  }
  async upload(name, text) {
    const b = `ramzan${Math.random().toString(36).slice(2)}`;
    const meta = { name, mimeType: 'application/json', description: 'Ramzan Electric Store & Hardware backup', appProperties: { app: 'ramzan-shop' } };
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${b}--`;
    const r = await this._req(`${API}/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,size`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
    return r.json();
  }
  async download(id) { return (await this._req(`${API}/drive/v3/files/${encodeURIComponent(id)}?alt=media`)).text(); }
  async remove(id) { await this._req(`${API}/drive/v3/files/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  /** Upload a dated backup, then delete the oldest ones beyond `keep`. */
  async backup(data, now = Date.now()) {
    const file = await this.upload(backupName(now), JSON.stringify(data));
    try { for (const old of (await this.list()).slice(this.keep)) await this.remove(old.id); } catch { /* cleanup is best effort */ }
    return file;
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
