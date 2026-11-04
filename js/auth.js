// PIN lock + roles. PINs are stored as salted PBKDF2 hashes on THIS device only.
// NOTE: this keeps casual users out of the app; it cannot stop someone with
// technical access to the phone's browser storage. Keep a Google Drive backup so data is safe if the phone is lost.
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

export class Auth {
  constructor(store, { now = () => Date.now(), iterations = 120000 } = {}) { this.store = store; this.now = now; this.iter = iterations; }

  async isSetUp() { return !!(await this.store.get('meta', 'pin:admin')); }
  async hasSalesman() { return !!(await this.store.get('meta', 'pin:salesman')); }

  async setPin(role, pin) {
    if (!['admin', 'salesman'].includes(role)) throw new AuthError('Unknown role', 'role');
    if (!/^\d{4,8}$/.test(String(pin))) throw new AuthError('PIN must be 4 to 8 digits', 'format');
    const other = await this.store.get('meta', role === 'admin' ? 'pin:salesman' : 'pin:admin');
    if (other && (await hashPin(pin, other.salt, other.iter)) === other.hash) throw new AuthError('Admin and salesman PINs must be different', 'same');
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    await this.store.batch([{ col: 'meta', obj: { id: `pin:${role}`, salt, iter: this.iter, hash: await hashPin(String(pin), salt, this.iter) } }]);
  }
  async removeSalesman() { await this.store.batch([{ col: 'meta', del: 'pin:salesman' }]); }

  /** Returns 'admin' | 'salesman'. Throws AuthError on wrong PIN or while locked out. */
  async login(pin) {
    const lock = (await this.store.get('meta', 'lockout')) || { id: 'lockout', fails: 0, until: 0 };
    if (lock.until > this.now()) throw new AuthError('Too many attempts. Try again later.', 'locked', lock.until - this.now());
    for (const role of ['admin', 'salesman']) {
      const r = await this.store.get('meta', `pin:${role}`);
      if (r && (await hashPin(String(pin), r.salt, r.iter)) === r.hash) {
        await this.store.batch([{ col: 'meta', obj: { id: 'lockout', fails: 0, until: 0 } }]);
        return role;
      }
    }
    lock.fails += 1;
    if (lock.fails >= 5) lock.until = this.now() + Math.min(15 * 60000, 30000 * 2 ** (lock.fails - 5));
    await this.store.batch([{ col: 'meta', obj: lock }]);
    throw new AuthError('Wrong PIN', 'wrong', lock.until > this.now() ? lock.until - this.now() : 0);
  }
}
