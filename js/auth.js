// Users, PIN login, Master Admin PIN recovery. PINs are stored as salted PBKDF2 hashes on THIS device only.
// NOTE: this keeps casual users out of the app; it cannot stop someone with technical access to the phone's
// browser storage. Keep a Google Drive backup so data is safe if the phone is lost.
const enc = new TextEncoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class AuthError extends Error {
  constructor(message, code, retryMs = 0) { super(message); this.code = code; this.retryMs = retryMs; }
}
export async function hashPin(pin, saltB64, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations }, key, 256);
  return b64(new Uint8Array(bits));
}
export const USERNAME_RE = /^[A-Za-z0-9._-]{3,20}$/, PIN_RE = /^\d{4,8}$/;
const norm = (u) => String(u ?? '').trim().toLowerCase();
const ROLES = ['admin', 'salesman'];

export class Auth {
  constructor(store, { now = () => Date.now(), iterations = 120000 } = {}) { this.store = store; this.now = now; this.iter = iterations; }

  // ---------- records ----------
  async _secret(id, extra, pin) {
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    return { id, ...extra, salt, iter: this.iter, hash: await hashPin(String(pin), salt, this.iter) };
  }
  async _matches(rec, pin) { return !!rec && (await hashPin(String(pin), rec.salt, rec.iter)) === rec.hash; }
  _checkPin(pin) { if (!PIN_RE.test(String(pin))) throw new AuthError('PIN must be 4 to 8 digits', 'format'); }

  /** Older versions had one Admin PIN and one Salesman PIN: turn them into users "admin" / "salesman"; Master PIN starts equal to the old admin PIN. */
  async migrateLegacy() {
    const a = await this.store.get('meta', 'pin:admin');
    if (!a) return false;
    const s = await this.store.get('meta', 'pin:salesman'), ops = [];
    ops.push({ col: 'meta', obj: { ...a, id: 'user:admin', username: 'admin', role: 'admin' } }, { col: 'meta', del: 'pin:admin' });
    if (s) ops.push({ col: 'meta', obj: { ...s, id: 'user:salesman', username: 'salesman', role: 'salesman' } }, { col: 'meta', del: 'pin:salesman' });
    if (!(await this.store.get('meta', 'master'))) ops.push({ col: 'meta', obj: { ...a, id: 'master' } });
    await this.store.batch(ops);
    return true;
  }
  async listUsers() {
    await this.migrateLegacy();
    return (await this.store.all('meta')).filter((m) => m.id.startsWith('user:')).map((m) => ({ username: m.username, role: m.role })).sort((a, b) => a.username.localeCompare(b.username));
  }
  async isSetUp() { return (await this.listUsers()).length > 0; }

  // ---------- users ----------
  async createUser({ username, pin, role = 'salesman' }) {
    if (!USERNAME_RE.test(String(username ?? '').trim())) throw new AuthError('Username must be 3-20 letters, digits, . _ -', 'username');
    this._checkPin(pin);
    if (!ROLES.includes(role)) throw new AuthError('Unknown role', 'role');
    const id = `user:${norm(username)}`;
    if (await this.store.get('meta', id)) throw new AuthError('That username is already taken', 'exists');
    await this.store.batch([{ col: 'meta', obj: await this._secret(id, { username: String(username).trim(), role }, pin) }]);
  }
  /** first run: the admin account + the Master Admin PIN used for recovery */
  async setupFirstAdmin({ username, pin, masterPin }) {
    if (await this.isSetUp()) throw new AuthError('Already set up', 'exists');
    this._checkPin(masterPin);
    await this.createUser({ username, pin, role: 'admin' });
    await this.setMasterPin(masterPin);
  }
  async removeUser(username) {
    const users = await this.listUsers(), u = users.find((x) => norm(x.username) === norm(username));
    if (!u) throw new AuthError('No such user', 'nouser');
    if (u.role === 'admin' && users.filter((x) => x.role === 'admin').length === 1) throw new AuthError('At least one admin is required', 'last_admin');
    await this.store.batch([{ col: 'meta', del: `user:${norm(username)}` }]);
  }
  async resetPin(username, newPin) {
    this._checkPin(newPin);
    const rec = await this.store.get('meta', `user:${norm(username)}`);
    if (!rec) throw new AuthError('No such user', 'nouser');
    await this.store.batch([{ col: 'meta', obj: await this._secret(rec.id, { username: rec.username, role: rec.role }, newPin) }, { col: 'meta', del: `lock:user:${norm(username)}` }]);
  }
  async changePin(username, oldPin, newPin) {
    if (!(await this.verifyPin(username, oldPin))) throw new AuthError('Wrong PIN', 'wrong');
    await this.resetPin(username, newPin);
  }

  // ---------- lockout: 5 wrong tries -> wait 30s, doubling up to 15 min ----------
  async _lock(id) { return (await this.store.get('meta', id)) || { id, fails: 0, until: 0 }; }
  async _guard(id) { const l = await this._lock(id); if (l.until > this.now()) throw new AuthError('Too many attempts. Try again later.', 'locked', l.until - this.now()); return l; }
  async _fail(l) {
    l.fails += 1; if (l.fails >= 5) l.until = this.now() + Math.min(15 * 60000, 30000 * 2 ** (l.fails - 5));
    await this.store.batch([{ col: 'meta', obj: l }]);
    return l.until > this.now() ? l.until - this.now() : 0;
  }
  async _clear(l) { if (l.fails) await this.store.batch([{ col: 'meta', obj: { id: l.id, fails: 0, until: 0 } }]); }

  /** returns { username, role }. Wrong username and wrong PIN look the same. */
  async login(username, pin) {
    await this.migrateLegacy();
    const l = await this._guard(`lock:user:${norm(username)}`), rec = await this.store.get('meta', `user:${norm(username)}`);
    if (await this._matches(rec, pin)) { await this._clear(l); return { username: rec.username, role: rec.role }; }
    throw new AuthError('Wrong username or PIN', 'wrong', await this._fail(l));
  }
  /** re-check the PIN of a signed-in user before a sensitive action. true / false (throws only while locked out) */
  async verifyPin(username, pin) {
    const l = await this._guard(`lock:user:${norm(username)}`), rec = await this.store.get('meta', `user:${norm(username)}`);
    if (await this._matches(rec, pin)) { await this._clear(l); return true; }
    await this._fail(l); return false;
  }

  // ---------- Master Admin PIN ----------
  async hasMaster() { return !!(await this.store.get('meta', 'master')); }
  async setMasterPin(pin) { this._checkPin(pin); await this.store.batch([{ col: 'meta', obj: await this._secret('master', {}, pin) }]); }
  async verifyMaster(pin) {
    const l = await this._guard('lock:master'), rec = await this.store.get('meta', 'master');
    if (await this._matches(rec, pin)) { await this._clear(l); return true; }
    await this._fail(l); return false;
  }
}
