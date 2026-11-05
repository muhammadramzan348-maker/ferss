# What changed in this update

## Removed (Supabase / cloud sync)
- `js/sync.js`, `supabase/schema.sql`, `tests/sync.test.js`, `tests/mock-supabase.js`
- Sync card in Settings, auto-sync timers and the sync button in `js/app.js`, outbox/onChange/applyRemote in `js/db.js`, `outbox` store in `js/store.js`.

## New files
| File | Purpose |
|---|---|
| `js/gdrive.js` | Google Drive API (upload, list, download, delete old, validate) + Google sign-in token |
| `js/ui/backup_actions.js` | `startGoogleBackup()` and `startGoogleRestore()` (+ Settings buttons) |
| `js/theme.js` | Light / Dark mode, saved in `localStorage` key `theme` |
| `js/ui/khata_screen.js` | Khata Entry screen (`#/khata`) |
| `GOOGLE_DRIVE_SETUP.txt` | One-time Google Cloud setup (Roman Urdu) |
| `tests/fixes.test.js`, `tests/gdrive.test.js`, `tests/fake-dom.js` | Regression tests for everything below |

## Changed files
`js/core.js` (exact weight pricing, `parseQtyLoose`), `js/db.js` (`preview()`, line notes, `findCustomer()`), `js/store.js`, `js/print.js`
(notes + price per sell unit on receipts), `js/i18n.js`, `js/app.js` (khata route, theme button, ☰ More menu), `js/ui/ctx.js`,
`js/ui/main_screens.js` (shared line sheet), `js/ui/stock_screens.js`, `js/ui/settings_screen.js`, `css/app.css` (dark theme),
`index.html` (theme before first paint), `tools/sw.template.js`, `sw.js` (regenerated).

## Bugs fixed
1. **`S.shop.preview is not a function`** - `Shop.preview()` was missing (a patch had silently not been applied). Added, and a test now
   fails if the UI ever calls a `S.shop.*` method that does not exist. The test also adds an item through the real UI action.
2. **Weight -> cost** - the price is now always "per sell unit" (Rs 15 per kg) and the line total is computed exactly with ONE rounding at
   the end. Before, 250 g of a Rs 15/kg item was priced from a rounded per-gram price (2 paise) = Rs 5.00 instead of Rs 3.75.
   Quantity also accepts `0.25`, `1/4`, `1 1/2`, `½`.
3. The phone's bottom bar had no way to reach Reports/Rentals: added a **☰ More** menu.

## Existing data
Nothing to migrate. Old bills keep their stored totals. After deploying, close and reopen the installed app twice so the new
offline cache is picked up (or Chrome > Site settings > Clear & reset).

---
# Branding update
- **App icon / favicon / Apple icon / maskable icon** are now your logo (`icons/`).
- **Logo** (`img/logo-256.png`, `img/logo-512.png`): lock screen, top bar, sidebar, Settings card, A4 invoice/PDF header, optional on thermal receipts
  (Settings -> "Print logo on thermal receipt", off by default because gold prints faintly on thermal paper).
- **Banner with contact number** (`img/banner.jpg`): top of the Dashboard. Tap it to share the shop card on WhatsApp.
- Receipts now default to the banner details: 03006703028, Noor-e-Wali, Rahim Yar Khan (editable in Settings -> Shop details).
- Changed: `js/app.js`, `js/print.js`, `js/db.js`, `js/i18n.js`, `js/ui/main_screens.js`, `js/ui/output.js`, `js/ui/settings_screen.js`, `css/app.css`, `index.html`, `tools/gen_sw.py`, `sw.js`.

---
# Update: Drive overwrite, banner size, Roman Urdu, date-wise rentals, data safety
1. **Google Drive:** one fixed file `ramzan_store_backup.json`. If it exists it is UPDATED in place (same file, no duplicate); otherwise created.
   Old dated backups / accidental duplicates are removed, so Restore shows one latest backup. If the file was deleted in Drive, a new one is created.
2. **Banner:** full width on phones; on tablets max 520px, on PC max 420px, centred, `height:auto` (`css/app.css`).
   Settings -> "Show shop banner on Dashboard" switch hides it completely.
3. **Roman Urdu** replaces Urdu script everywhere (all screens, units, categories, receipts, WhatsApp messages). Layout is always left-to-right.
   Old Urdu-script *category* names are converted automatically. Item names you typed earlier in Urdu script stay as typed (edit them in Items).
4. **Rentals are date-wise:** every calendar day from the day it was given to the day it came back (both included) is charged.
   Rs 100/day, given on the 4th, returned on the 5th = Rs 200. Pick the given date when renting and the return date when returning
   (back-dating allowed, future dates refused). The Return screen shows the date-by-date rent, deposit, amount to collect; after returning you get
   a bill (also WhatsApp). New rental detail page, address field, per-day rate on every card. Hourly items still work.
5. **Data safety:** permanent-storage request, writes flushed to disk before "saved" (`durability: strict`, one atomic transaction per posting),
   Settings -> Data safety (status, record counts, "Check my data" self-check, "Download backup now"), backup reminder after 7 days.
Files: `js/gdrive.js`, `js/ui/backup_actions.js`, `js/i18n.js`, `js/core.js`, `js/db.js`, `js/store.js`, `js/app.js`, `js/print.js`,
`js/ui/ops_screens.js`, `js/ui/main_screens.js`, `js/ui/settings_screen.js`, `js/ui/stock_screens.js`, `js/ui/ctx.js`, `css/app.css`, tests.
