// Per-app configuration. Safe to commit: the Google OAuth Client ID is a public
// identifier (not a secret) and is locked to this site's authorized origins.
//
// This is the "umbrella" setup: one Google OAuth client is reused across your
// apps. Each app sets a unique `appKey`, which becomes its data filename
// (`<appKey>.json`) inside the shared hidden appDataFolder — so apps never
// collide. To enable Google Drive sync, paste the umbrella Client ID below.
const APP_CONFIG = {
  googleClientId: '158219000026-vmfin9cb3h0f2cvh7eo4bdtr11qi7tcl.apps.googleusercontent.com',
  appKey: 'fm-forbidden-memories', // → Drive file 'fm-forbidden-memories.json'
};
