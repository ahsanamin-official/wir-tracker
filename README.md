# WIR Tracker — multi-user, Firebase (Spark/free) edition

Your existing Weekly Inspection Report app (same UI, forms, calculations and 9-section report engine), now backed by **Firebase Auth + Firestore** with roles, a Draft → Submitted → Approved/Returned workflow, live sync and offline support. One codebase runs as a **website (GitHub Pages)** and inside **Electron** — both use the same Firebase project.

> The uploaded project was a static frontend + Flask API (not Electron). I added a small Electron wrapper (`electron/main.js`). The Flask backend is now **optional** and used only for Word/PDF export.

## What changed
| Area | Before | Now |
|---|---|---|
| Data | IndexedDB (per browser) | Firestore (shared, real-time, offline cache) |
| Users | none | Firebase Auth (email/password) + `users/{uid}` role doc |
| Report status | Draft/Final | Draft → **Submitted** → **Approved** / **Returned** (locked while submitted/approved) |
| Photos | full-size data-URLs in IndexedDB | resized (~1280px JPEG) and stored in Firestore — see *Free-tier limits* |
| Files | — | `firestore.rules`, `frontend/js/{storage,auth,defaults}.js`, `electron/`, `scripts/gen-config.js`, `.github/workflows/pages.yml` |

## Roles
| Role | Can do |
|---|---|
| ADMIN | everything: users, sites, project setup, all reports, import/delete |
| SUPERVISOR | read assigned sites; **approve / return** submitted reports |
| INSPECTOR | assigned sites; create, edit, submit reports + daily/materials/photos while report is Draft/Returned; delete own Drafts |
| VIEWER | read-only on assigned sites |

All of this is enforced by `firestore.rules` on the server, not just hidden buttons.

## 1. Firebase setup (free Spark plan)
1. https://console.firebase.google.com → **Add project** (no billing needed; disable Analytics).
2. **Project settings → Your apps → Web (`</>`)** → register app → copy the config values.
3. Copy `.env.example` → `.env` and fill in `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`, `FIREBASE_MESSAGING_SENDER_ID`.
4. `npm run config` → writes `frontend/js/firebase-config.js` (public web config, not a secret).

## 2. Authentication
Console → **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**.
(Later, when hosting on GitHub Pages: **Settings → Authorized domains → add `<your-user>.github.io`**.)

## 3. Firestore
Console → **Build → Firestore Database → Create database** → *production mode* → pick the region nearest you (cannot be changed later). **Do not enable Cloud Storage** (see limits below).

## 4. Security rules
Paste `firestore.rules` into **Firestore → Rules → Publish**, or with the CLI:
```bash
npm i -g firebase-tools && firebase login && firebase use --add   # pick your project
npm run deploy:rules
```
Test them in the console **Rules Playground** or the Firebase Emulator before real use — I could not run the emulator in my environment, so the rules are reviewed but not emulator-tested.

## 5. Create the first admin (one-time, manual)
1. Console → **Authentication → Users → Add user** (email + strong password). Copy the **User UID**.
2. Console → **Firestore → Start collection** `users` → Document ID = **the UID** → fields:
   `name` (string), `email` (string), `role` = `ADMIN` (string), `siteIds` (array, empty), `active` = `true` (boolean).
3. Sign in to the app → **Sites → Add Site**, then **Users & Roles → Add User** for everyone else (name, email, temporary password, role, sites). Users can use *Forgot password?* on the login screen. Accounts can be deactivated (not deleted) from the Users page.

**Migrating your old local data:** in the *old* app go to Settings → *Export Project Data (JSON)*; in the new app (as ADMIN) Settings → *Import Data (JSON)*. Photos are re-compressed on import.

## 6. Run locally
```bash
npm run config                                   # once, after editing .env
python3 -m http.server 8080 --directory frontend # or: npm run web
# open http://localhost:8080
```
Optional Word/PDF export backend (unchanged): `cd backend && pip install -r requirements.txt && python app.py` (PDF needs LibreOffice). Set `WIR_API_BASE_URL` in `.env` if it is not on `localhost:5000`. Export works only while this backend is running on your machine.

## 7. Deploy to GitHub Pages
1. Push this folder to a GitHub repo (`main`). `.env` is git-ignored.
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. Repo **Settings → Secrets and variables → Actions → *Variables*** → add `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`, `FIREBASE_MESSAGING_SENDER_ID`.
4. Push → workflow `Deploy to GitHub Pages` builds and publishes `frontend/`. Add the `github.io` domain to Firebase **Authorized domains** (step 2).

## 8. Electron
```bash
npm install
npm run config
npm start          # desktop app, same Firebase backend
npm run dist       # installers in ./release (electron-builder)
```

## Free-tier (Spark) limits — and how the app stays inside them
- Firestore: **50k reads / 20k writes / 20k deletes per day, 1 GiB stored**. The app keeps live listeners + an offline cache, so screens read from memory; a fresh session costs roughly one read per report/daily/material record. A small team is comfortably inside the quota; if you hit it, Firestore returns errors until the daily reset.
- **Cloud Storage is not used**: since Feb 2026 it requires the paid Blaze plan even for free-tier usage. Photos are resized to ≤ ~800 KB and stored as Firestore documents (rules cap them under 900 KB). ~1 GiB ≈ several thousand photos. If you later upgrade to Blaze, photos can be moved to Storage.
- Auth: 50k monthly active users (email/password is free). Password-reset emails use Firebase's default sender.
- Offline: edits are queued locally and sync automatically; the sidebar shows Online/Syncing/Offline. Reload while offline works only if the app was opened online before.
- Word/PDF export needs the local Flask backend (cannot run on Pages/Spark).
- Shared computers: sign out when done — the offline cache is per browser profile.
