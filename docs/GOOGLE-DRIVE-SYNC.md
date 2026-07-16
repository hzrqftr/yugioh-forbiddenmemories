# Google Drive sync — setup, reuse, and troubleshooting

This is the repeatable playbook for the Deck Builder's cross-device sync, and for
reusing the same sync module in **future** static apps. Keep it — the Google
Cloud Console UI changes wording often, and this captures the decisions and the
exact knobs that matter.

## What this is (and isn't)

- Users sign in with **their own** Google account and their data is stored in a
  **private file in the hidden `appDataFolder`** of **their own** Drive. You (the
  developer) never see it, and there is no server or database.
- Auth uses **Google Identity Services (GIS) token flow** in the browser — an
  OAuth **Client ID only, no client secret**. The Client ID is a public
  identifier, locked to your authorized origins, and **safe to commit**.
- Scope requested: `https://www.googleapis.com/auth/drive.appdata` (the hidden
  per-app folder only — the app cannot see the rest of the user's Drive).

## The "umbrella" design (why there's one client for many apps)

Drive's `appDataFolder` is **scoped per OAuth client**. So instead of a new Google
project per app, we use **one umbrella OAuth client reused across all apps**:

- One Google Cloud **project**, one **OAuth consent screen**, one **Client ID**.
- Every app sets a unique **`appKey`** in its `js/config.js`. That becomes the
  Drive filename `<appKey>.json`. All apps share the one hidden folder but never
  collide, because each reads/writes its own file.
- Adding a new app later = pick a new `appKey` + add that app's origin to the
  client's authorized origins. **No new project, no re-verification.**

This app's values:
- **Client ID:** `158219000026-vmfin9cb3h0f2cvh7eo4bdtr11qi7tcl.apps.googleusercontent.com`
- **appKey:** `fm-forbidden-memories` → Drive file `fm-forbidden-memories.json`

## First-time setup (do this once, ever)

In the [Google Cloud Console](https://console.cloud.google.com):

1. **Create a project** (e.g. `hzrqftr-apps`). Reuse it for all future apps.
2. **Enable the Google Drive API.** APIs & Services → Library → "Google Drive API"
   → **Enable**.
3. **Configure the OAuth consent screen** (a.k.a. *Google Auth Platform → Branding
   / Audience*):
   - **User type:** External.
   - **App name:** a neutral umbrella brand (e.g. `hzrqftr apps`). This is the name
     users see on the consent popup — it is not per-app. *(Currently it reads
     `hzrq-dev`; cosmetic, fine to rename under Branding.)*
   - **User support email** + **developer contact email:** your email.
   - **Publishing status: keep it in `Testing`.** For personal use you do **not**
     submit for Google verification.
4. **Add yourself (and anyone else who'll use it) as a Test user.** Consent screen
   / **Audience → Test users → + Add users** → the exact Gmail address(es) that
   will sign in. Up to 100; never expires. **This is the step most easily missed —
   see Troubleshooting.**
5. **Add the scope:** `.../auth/drive.appdata` (the "Drive appdata" /
   "See, create, and delete its own configuration data" scope). It is a
   non-sensitive/limited scope for this use.
6. **Create the OAuth Client ID.** APIs & Services → **Credentials → Create
   credentials → OAuth client ID**:
   - **Application type:** Web application.
   - **Authorized JavaScript origins:** every origin the site loads from
     (scheme + host + optional port, **no path, no trailing slash**). For this app:
     - `http://localhost:8123` (local dev server)
     - `https://hzrqftr.github.io` (GitHub Pages default origin)
     - `https://ourlittlemiracle.online` (the custom domain this repo's Pages also
       resolves to — add it if you access the site there; use the scheme you
       actually load over)
   - **Authorized redirect URIs:** not needed for the GIS token flow.
   - Copy the resulting **Client ID** into `js/config.js` → `APP_CONFIG.googleClientId`.

That's it. No secret is used or stored.

## Wiring it into an app

`js/config.js`:
```js
const APP_CONFIG = {
  googleClientId: '<the umbrella client id>',
  appKey: '<unique-kebab-app-key>',   // → Drive file '<appKey>.json'
};
```

The page must load GIS then the module (see the load order in
[`ARCHITECTURE.md`](ARCHITECTURE.md) §3):
```html
<script src="https://accounts.google.com/gsi/client" async></script>
...
<script src="js/config.js"></script>
<script src="js/drive-sync.js"></script>
```

Then, in the page controller:
```js
await DriveSync.init(APP_CONFIG.googleClientId, APP_CONFIG.appKey);
// wire buttons:
DriveSync.signIn();          // opens the Google popup (interactive)
await DriveSync.push(blob);  // write your JSON blob to Drive
const data = await DriveSync.pull();  // read it back
DriveSync.signOut();
DriveSync.isSignedIn();      // token present & unexpired
DriveSync.configured();      // client id + appKey present
```

`DriveSync` is self-contained and app-agnostic; its own header comment restates
this recipe so the file is portable on its own.

## Reusing in a NEW app (the fast path)

1. Copy `js/drive-sync.js` into the new app unchanged.
2. Add a `js/config.js` with the **same** `googleClientId` and a **new** `appKey`.
3. Load the GIS script + `config.js` + `drive-sync.js` (order above).
4. Call `DriveSync.init(...)` and wire `signIn` / `push` / `pull` to your data.
5. In the Console, add the new app's origin(s) to the **existing** OAuth client's
   Authorized JavaScript origins, and add any new test users.

No new project, no new client, no re-verification.

## The sign-in experience for users (Testing mode)

Because the app stays in **Testing** (unverified), an approved test user will see
a **"Google hasn't verified this app"** screen on first consent. That's expected:
**Advanced → Go to `<app name>` (unsafe) → Allow**. This is normal for a personal
app and does not mean anything is wrong. (Do **not** submit for verification just
to remove this — verification is for public apps and requires a lengthy review.)

## Troubleshooting

| Symptom | Cause | Fix |
|--------|-------|-----|
| **"Access blocked: … has not completed the Google verification process"**, `Error 403: access_denied` | The signing-in Google account is **not in Test users** (or a different email was added). | Console → consent screen / Audience → **Test users → add the exact Gmail** you sign in with. Retry. |
| `redirect_uri_mismatch` / `origin` errors | The site's origin isn't in **Authorized JavaScript origins** (or scheme/port mismatch, or a trailing slash was added). | Add the exact origin (scheme+host+port, no path/slash). Remember `http` vs `https` and the port must match. |
| Sign-in popup blocked | Browser popup blocker. | Allow popups for the site; trigger sign-in from a real click. |
| "Google sync not configured" in the status line | `APP_CONFIG.googleClientId` is empty or still a placeholder. | Set the real Client ID in `js/config.js`. |
| "Session expired — sign in again" | The short-lived access token expired (~1h). | Click Sign in again; then push/pull. |
| "No saved data found in Drive yet" on Pull | Nothing has been pushed for this `appKey` yet. | Push from a device that has data first. |

## Verifying changes (dev)

For automated checks, **mock** Google rather than hitting the network: stub
`window.google.accounts.oauth2` via `addInitScript`, intercept
`https://www.googleapis.com/**` and `https://accounts.google.com/**` with route
handlers, and route `js/config.js` to a fake `APP_CONFIG` (a test `appKey` proves
the `appKey → <appKey>.json` filename wiring). Assert `console errors == 0`. The
real OAuth popup + consent can only be exercised by a human.
