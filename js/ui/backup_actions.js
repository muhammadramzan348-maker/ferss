// startGoogleBackup() / startGoogleRestore(): the two entry points for Google Drive backup.
import { DriveBackup, getAccessToken } from '../gdrive.js';
import { fmtDateTime } from '../core.js';
import { S, acts, t, toast, openSheet, closeSheet, ask, refresh, esc, markBackup } from './ctx.js';

const clientId = () => (S.shop.cfg.googleClientId || '').trim();
function needClient() { toast(t('gd_need_client'), { error: true }); return true; }
const fail = (e) => toast(`${t('gd_failed')}: ${e.message}`, { error: true });

/** Save the whole shop (items, stock, khata, cash, rentals…) as a dated JSON file in the owner's Google Drive. */
export async function startGoogleBackup(api) {
  if (!api && !clientId()) return needClient();
  try {
    toast(t('gd_working'));
    const drive = api || new DriveBackup({ token: await getAccessToken(clientId()) });
    const file = await drive.backup(await S.shop.exportAll());
    markBackup();
    toast(`✔ ${t(file.mode === 'updated' ? 'gd_updated' : 'gd_created')} · ${file.name}`); refresh();
    return file;
  } catch (e) { fail(e); }
}

/** Show the backups found in Google Drive; tapping one replaces this phone's data with it. */
export async function startGoogleRestore(api) {
  if (!api && !clientId()) return needClient();
  try {
    toast(t('gd_working'));
    const drive = api || new DriveBackup({ token: await getAccessToken(clientId()) });
    S.drive = drive;
    const files = await drive.list();
    openSheet(`<h3>${t('gd_pick')}</h3>${files.length ? files.map((f) => `<button class="item" data-act="gdPick" data-id="${esc(f.id)}"><span>${esc(f.name)}<br><small>${t('gd_modified')}: ${fmtDateTime(Date.parse(f.modifiedTime || f.createdTime))}${f.size ? ` · ${Math.round(f.size / 1024)} KB` : ''}</small></span><span>⬇</span></button>`).join('') : `<p class="empty">${t('gd_none')}</p>`}`);
    return files;
  } catch (e) { fail(e); }
}
export async function restoreFromDrive(id, drive = S.drive) {
  const json = await drive.fetchBackup(id);
  const safety = await S.shop.exportAll();                         // keep a copy of what is on this phone right now
  const n = await S.shop.importAll(json);
  return { restored: n, safety };
}
function downloadJson(data, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })); a.download = name; a.click();
}

acts.googleBackup = () => startGoogleBackup();
acts.googleRestore = () => startGoogleRestore();
acts.gdPick = async (el) => {
  try {
    if (!ask(t('gd_confirm'))) return;
    const { restored, safety } = await restoreFromDrive(el.dataset.id);
    downloadJson(safety, `before-restore-${new Date().toISOString().slice(0, 10)}.json`);
    closeSheet(); toast(`✔ ${t('gd_restored')} (${restored})`); refresh();
  } catch (e) { fail(e); }
};
