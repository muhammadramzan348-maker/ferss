# RAMZAN ELECTRIC STORE & HARDWARE — Shop PWA

Installable web app (works offline) for: POS with reverse weight calculator, estimates, udhaar khata, WhatsApp
reminders/PDF, thermal receipts, suppliers & purchases, expenses, rentals (rehri/stool/phatta), reports, PIN lock with
Admin/Salesman roles, optional Supabase sync for two phones. English + Urdu (RTL). No build step, no dependencies.

## Run the tests
    node --test        # Node 20+; 48 tests

## Deploy (GitHub Pages)
1. Put this folder in your repository (e.g. `ramzan_pwa/`).
2. Add `.github/workflows/deploy-pwa.yml` at the REPOSITORY ROOT (copy from `COPY_THIS_TO_GITHUB/`). If the app files are at the
   repo root instead of `ramzan_pwa/`, change `APP_DIR: ramzan_pwa` to `APP_DIR: .`.
3. Repo → Settings → Pages → Source: **GitHub Actions**. Push; the workflow runs the tests, builds the offline cache list, deploys.
4. Open `https://<user>.github.io/<repo>/` on each phone → Chrome menu → **Install app**.

## Cloud sync (optional, 2 phones)
Run `supabase/schema.sql` in Supabase, create ONE user (email+password), then on each phone: Settings → Cloud sync →
different **phone letter** (A / B) on each phone, same URL/anon key/login → Sign in → Sync now.
Sales, stock movements, khata and cash entries are append-only, so both phones' work is merged (nothing is overwritten).
Editable records (item prices, customer details) use "latest edit wins".

## Printing
* **Thermal (recommended):** install the free *RawBT* app, pair the Bluetooth printer in Android, Settings → "RawBT".
* BLE printers can print directly ("Web Bluetooth"); USB/Wi-Fi/normal printers use "Browser print".
* Urdu prints correctly because receipts are drawn as an image.

## Design notes
* Money = integer paise, quantity = integer thousandths; no floating point. Rs 15 of Paris @ Rs 60/kg = exactly 250 g.
* Stock = sum of movements; cost = weighted average; sale cost is frozen on each bill.
* Cancel = reversal rows (nothing is erased). Sale returns are not included in this version (cancel + re-bill instead).
* Tax is not included in this version.
* PIN lock is local to each phone (PBKDF2 hash). It keeps people out of the app; it is not protection against someone with
  technical access to the phone. Salesman limits (no costs/profit/purchases/price change) are enforced inside the app logic.
* Invoice numbers include the phone letter (RES-2026-A000001 / B000001) so two phones never clash.
