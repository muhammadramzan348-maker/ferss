# RAMZAN ELECTRIC STORE & HARDWARE — Shop PWA

Installable, offline-first web app: POS with weight calculator, estimates, udhaar khata + Khata Entry screen, WhatsApp reminders/PDF,
thermal receipts, suppliers & purchases, expenses, rentals, reports, PIN lock (Admin/Salesman), Light/Dark mode, Google Drive backup.
English + Urdu (RTL). No build step, no dependencies. See `CHANGES.md` for the latest update.

    node --test        # Node 20+; 59 tests

## Deploy (GitHub Pages)
1. Put this folder in your repository (e.g. `ramzan_pwa/`).
2. Add `.github/workflows/deploy-pwa.yml` at the REPOSITORY ROOT (copy from `COPY_THIS_TO_GITHUB/`). If the app files are at the repo root,
   change `APP_DIR: ramzan_pwa` to `APP_DIR: .`.
3. Repo → Settings → Pages → Source: **GitHub Actions**. Every push runs the tests and deploys.
4. Open the site on the phone → Chrome menu → **Install app**.

## Backup
Settings → Google Drive backup (one-time setup in `GOOGLE_DRIVE_SETUP.txt`), or Settings → Backup (JSON) for a file on the phone.

## Design notes
* Money = integer paise, quantity = integer thousandths. A line's price is per SELL unit; totals are exact (one rounding).
* Stock = sum of movements; cost = weighted average; a sale's cost is frozen on the bill. Cancel = reversal rows.
* PIN lock is per phone (PBKDF2 hash). It keeps people out of the app; it is not protection against technical access to the phone.
* Not included: sale returns, tax. Printing: RawBT app (recommended), BLE Web Bluetooth, or browser print.
