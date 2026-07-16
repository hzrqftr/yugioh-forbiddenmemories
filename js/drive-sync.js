// DriveSync — portable two-way JSON sync to a user's Google Drive, no backend.
// Google Identity Services yields a short-lived access token (no secret); the
// data lives in one file inside the hidden per-app appDataFolder.
//
// REUSE RECIPE (drop into any static app):
//   1. Copy this file.
//   2. Add config.js: `const APP_CONFIG = { googleClientId: '<umbrella client id>',
//      appKey: '<unique-app-key>' };`  (appKey → the Drive filename `<appKey>.json`,
//      so multiple apps sharing one OAuth client never collide.)
//   3. Load Google Identity Services: <script src="https://accounts.google.com/gsi/client" async>
//   4. `DriveSync.init(APP_CONFIG.googleClientId, APP_CONFIG.appKey)`, then wire
//      `signIn()` / `push(yourBlob)` / `pull()` to your data.
//   5. Add the app's origin to the umbrella OAuth client's Authorized JS origins.
// The Client ID is public/safe to commit; appDataFolder is scoped per OAuth client,
// so all apps reusing one client share a hidden folder, separated by filename.
// The short-lived access token is cached in sessionStorage (per tab) so navigating
// between the app's pages doesn't force a fresh sign-in; it clears when the tab
// closes and on signOut(). No refresh token / secret is ever stored.
const DriveSync = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

  let clientId = '';
  let fileName = '';          // `${appKey}.json`
  let tokenClient = null;
  let accessToken = null;
  let tokenExpiry = 0;        // epoch ms
  let cachedFileId = null;    // Drive file id for this session

  const configured = () => !!clientId && !clientId.startsWith('<') && !!fileName;

  // ── Token cache (sessionStorage, keyed per client so reused clients don't clash)
  const tokenKey = () => 'drivesync-token:' + clientId;
  function persistToken() {
    try { sessionStorage.setItem(tokenKey(), JSON.stringify({ accessToken, tokenExpiry })); } catch { /* ignore */ }
  }
  function restoreToken() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(tokenKey()) || 'null');
      if (saved && saved.accessToken && Date.now() < saved.tokenExpiry) {
        accessToken = saved.accessToken;
        tokenExpiry = saved.tokenExpiry;
      }
    } catch { /* ignore */ }
  }
  function clearToken() {
    accessToken = null; tokenExpiry = 0; cachedFileId = null;
    try { sessionStorage.removeItem(tokenKey()); } catch { /* ignore */ }
  }

  // Resolve once the GIS script global is present (loaded async in the page).
  function waitForGis(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function poll() {
        if (window.google?.accounts?.oauth2) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error('Google sign-in script failed to load'));
        setTimeout(poll, 100);
      })();
    });
  }

  async function init(id, appKey) {
    clientId = id || '';
    fileName = appKey ? `${appKey}.json` : '';
    if (!configured()) return false;
    restoreToken(); // reuse a still-valid token from this tab session (no popup)
    await waitForGis();
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: () => {}, // replaced per-request in getToken()
    });
    return true;
  }

  const isSignedIn = () => !!accessToken && Date.now() < tokenExpiry;

  // Request an access token. prompt:'' is silent when a Google session +
  // prior consent exist; otherwise GIS shows the popup.
  function getToken({ interactive } = {}) {
    return new Promise((resolve, reject) => {
      // A restored/cached token works even if GIS hasn't finished loading.
      if (isSignedIn()) return resolve(accessToken);
      if (!tokenClient) return reject(new Error('Sync not configured'));
      tokenClient.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + ((resp.expires_in || 3600) - 60) * 1000;
        persistToken();
        resolve(accessToken);
      };
      tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    });
  }

  const signIn = () => getToken({ interactive: true });
  function signOut() {
    if (accessToken && window.google?.accounts?.oauth2) {
      try { window.google.accounts.oauth2.revoke(accessToken); } catch { /* ignore */ }
    }
    clearToken();
  }

  async function api(url, opts = {}) {
    const token = await getToken();
    const res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
    if (res.status === 401) { clearToken(); throw new Error('Session expired — sign in again'); }
    if (!res.ok) throw new Error(`Drive error ${res.status}`);
    return res;
  }

  async function findFileId() {
    if (cachedFileId) return cachedFileId;
    const q = encodeURIComponent(`name='${fileName}'`);
    const res = await api(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)`);
    const j = await res.json();
    cachedFileId = j.files && j.files[0] ? j.files[0].id : null;
    return cachedFileId;
  }

  async function push(obj) {
    const content = JSON.stringify(obj);
    let id = await findFileId();
    if (!id) {
      // Create the metadata (in appDataFolder), then write its contents.
      const meta = await api('https://www.googleapis.com/drive/v3/files?fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fileName, parents: ['appDataFolder'] }),
      });
      id = (await meta.json()).id;
      cachedFileId = id;
    }
    await api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: content,
    });
    return id;
  }

  async function pull() {
    const id = await findFileId();
    if (!id) throw new Error('No saved data found in Drive yet');
    const res = await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    return res.json();
  }

  return { init, configured, isSignedIn, signIn, signOut, push, pull };
})();
