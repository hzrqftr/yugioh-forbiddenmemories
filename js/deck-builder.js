// Deck Builder UI. Left = collection (own 0–3 per card); right = active deck
// (owned-aware, not enforced). All state flows through DeckStore.

const CARD_TYPES = ['All', 'Monster', 'Magic', 'Trap', 'Ritual', 'Equip', 'Field'];
const SORT_FIELDS = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'atk', label: 'ATK' },
  { key: 'def', label: 'DEF' },
];
const DECK_MIN = 40;
const dbState = { query: '', typeFilter: 'All', sortBy: 'id', sortDir: 'asc' };
let allCards = [];

init();

async function init() {
  try {
    await loadCoreData();
  } catch (err) {
    document.getElementById('deck-list').innerHTML = `<li class="library-empty">Failed to load card data: ${escapeHtml(err.message)}</li>`;
    return;
  }

  allCards = [...state.cardsById.values()].sort((a, b) => a.id.localeCompare(b.id));
  DeckStore.ensureDeck();

  buildTypeSelect();
  buildSortControls();
  wireEvents();
  DeckStore.onChange(renderAll);
  renderAll();
  initSync();
}

/* ── Events ──────────────────────────────────────────────────────────────── */

function wireEvents() {
  document.getElementById('collection-search').addEventListener('input', (e) => {
    dbState.query = e.target.value;
    renderCollection();
  });

  document.getElementById('collection-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'own-inc') DeckStore.setOwned(id, DeckStore.getOwned(id) + 1);
    else if (btn.dataset.action === 'own-dec') DeckStore.setOwned(id, DeckStore.getOwned(id) - 1);
    else if (btn.dataset.action === 'add-deck') addToDeck(id);
  });

  document.getElementById('deck-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const deck = DeckStore.getActiveDeck();
    if (!deck) return;
    const cur = deck.cards[id] || 0;
    if (btn.dataset.action === 'deck-remove-one') DeckStore.setDeckCard(deck.id, id, cur - 1);
  });

  document.getElementById('deck-select').addEventListener('change', (e) => DeckStore.setActiveDeckId(e.target.value));
  document.getElementById('deck-new').addEventListener('click', () => {
    const name = window.prompt('Name for the new deck:', 'Deck ' + (DeckStore.getDecks().length + 1));
    if (name !== null) DeckStore.createDeck(name.trim() || undefined);
  });
  document.getElementById('deck-rename').addEventListener('click', () => {
    const deck = DeckStore.getActiveDeck();
    if (!deck) return;
    const name = window.prompt('Rename deck:', deck.name);
    if (name !== null && name.trim()) DeckStore.renameDeck(deck.id, name.trim());
  });
  document.getElementById('deck-delete').addEventListener('click', () => {
    const deck = DeckStore.getActiveDeck();
    if (deck && window.confirm(`Delete deck "${deck.name}"?`)) DeckStore.deleteDeck(deck.id);
  });

  document.getElementById('deck-export').addEventListener('click', exportFile);
  document.getElementById('deck-import-btn').addEventListener('click', () => document.getElementById('deck-import').click());
  document.getElementById('deck-import').addEventListener('change', importFile);

  document.getElementById('sync-signin').addEventListener('click', doSignIn);
  document.getElementById('sync-signout').addEventListener('click', doSignOut);
  document.getElementById('sync-push').addEventListener('click', () => runSync('push'));
  document.getElementById('sync-pull').addEventListener('click', () => runSync('pull'));
}

function addToDeck(id) {
  const deck = DeckStore.getActiveDeck();
  if (!deck) return;
  DeckStore.setDeckCard(deck.id, id, (deck.cards[id] || 0) + 1);
}

/* ── Collection pane ─────────────────────────────────────────────────────── */

function buildTypeSelect() {
  const sel = document.getElementById('collection-type');
  sel.innerHTML = CARD_TYPES
    .map((t) => `<option value="${t}"${t === dbState.typeFilter ? ' selected' : ''}>${t === 'All' ? 'All types' : t}</option>`)
    .join('');
  sel.addEventListener('change', () => { dbState.typeFilter = sel.value; renderCollectionTop(); });
}

function buildSortControls() {
  const sel = document.getElementById('collection-sort');
  sel.innerHTML = SORT_FIELDS
    .map((f) => `<option value="${f.key}"${f.key === dbState.sortBy ? ' selected' : ''}>Sort: ${f.label}</option>`)
    .join('');
  sel.addEventListener('change', () => { dbState.sortBy = sel.value; renderCollectionTop(); });

  const dirBtn = document.getElementById('collection-sort-dir');
  dirBtn.addEventListener('click', () => {
    dbState.sortDir = dbState.sortDir === 'asc' ? 'desc' : 'asc';
    const asc = dbState.sortDir === 'asc';
    dirBtn.textContent = asc ? '↑' : '↓';
    dirBtn.setAttribute('aria-label', asc ? 'Sort ascending' : 'Sort descending');
    renderCollectionTop();
  });
}

// Re-render the collection and jump back to the top (a changed filter/sort makes
// the old scroll position meaningless).
function renderCollectionTop() {
  renderCollection();
  document.getElementById('collection-list').scrollTop = 0;
}

function visibleCards() {
  const q = dbState.query.trim().toLowerCase();
  const filtered = allCards.filter((c) => {
    if (dbState.typeFilter !== 'All' && c.cardType !== dbState.typeFilter) return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    return true;
  });
  return sortCards(filtered);
}

// Sort by the chosen field/direction. ATK/DEF are numeric; cards without a value
// (Magic/Trap/etc.) always sink to the bottom regardless of direction. Ties and
// the sunk group fall back to a stable ascending-by-id order.
function sortCards(cards) {
  const { sortBy, sortDir } = dbState;
  const dir = sortDir === 'asc' ? 1 : -1;
  const byId = (a, b) => a.id.localeCompare(b.id);
  const num = (v) => { const n = parseInt(v, 10); return Number.isNaN(n) ? null : n; };
  return cards.slice().sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'name') {
      cmp = a.name.localeCompare(b.name);
    } else if (sortBy === 'atk' || sortBy === 'def') {
      const av = num(a[sortBy]);
      const bv = num(b[sortBy]);
      if (av === null && bv === null) return byId(a, b);
      if (av === null) return 1;
      if (bv === null) return -1;
      cmp = av - bv;
    } else {
      cmp = byId(a, b);
    }
    if (cmp === 0) cmp = byId(a, b);
    return cmp * dir;
  });
}

function renderCollection() {
  const listEl = document.getElementById('collection-list');
  const countEl = document.getElementById('collection-count');
  const cards = visibleCards();
  const distinct = DeckStore.ownedCount();
  const total = DeckStore.ownedTotal();
  countEl.textContent = distinct
    ? `collection · ${distinct} unique · ${total} total`
    : 'collection';

  const activeDeck = DeckStore.getActiveDeck();
  const scroll = listEl.scrollTop;
  listEl.innerHTML = cards.map((c) => {
    const owned = DeckStore.getOwned(c.id);
    const inDeck = activeDeck ? (activeDeck.cards[c.id] || 0) : 0;
    // Deck membership takes precedence; otherwise flag cards owned but unused.
    let tag = '';
    if (inDeck) tag = `<span class="in-deck-tag" title="${inDeck} in the current deck">in deck ×${inDeck}</span>`;
    else if (owned) tag = `<span class="in-trunk-tag" title="${owned} owned, not in the current deck">in trunk ×${owned}</span>`;
    return `
      <li class="library-row deck-row${inDeck ? ' in-deck' : ''}">
        <span class="row-id">#${escapeHtml(c.id)}</span>
        <span class="row-name">${escapeHtml(c.name)}</span>
        ${tag}
        <span class="qty-stepper" role="group" aria-label="Owned quantity">
          <button type="button" class="qty-btn" data-action="own-dec" data-id="${escapeHtml(c.id)}" ${owned === 0 ? 'disabled' : ''} aria-label="Own one fewer">&minus;</button>
          <span class="qty-val${owned ? ' has' : ''}">${owned}</span>
          <button type="button" class="qty-btn" data-action="own-inc" data-id="${escapeHtml(c.id)}" ${owned >= DeckStore.MAX_COPIES ? 'disabled' : ''} aria-label="Own one more">+</button>
        </span>
        <button type="button" class="add-deck-btn" data-action="add-deck" data-id="${escapeHtml(c.id)}" aria-label="Add to deck">+deck</button>
      </li>`;
  }).join('') || '<li class="library-empty">No cards match.</li>';
  listEl.scrollTop = scroll;
}

/* ── Deck pane ───────────────────────────────────────────────────────────── */

function renderDeckHead() {
  const sel = document.getElementById('deck-select');
  const decks = DeckStore.getDecks();
  const activeId = DeckStore.getActiveDeckId();
  sel.innerHTML = decks.map((d) => `<option value="${escapeHtml(d.id)}"${d.id === activeId ? ' selected' : ''}>${escapeHtml(d.name)} (${DeckStore.deckTotal(d)})</option>`).join('');

  const deck = DeckStore.getActiveDeck();
  const meter = document.getElementById('deck-meter');
  if (!deck) { meter.textContent = ''; return; }
  const total = DeckStore.deckTotal(deck);
  const ok = total >= DECK_MIN;
  meter.className = 'deck-meter' + (ok ? ' ok' : ' under');
  meter.innerHTML = `<span class="meter-count">${total} / ${DECK_MIN}</span>` +
    (ok ? '<span class="meter-note">deck ready</span>' : `<span class="meter-note">need ${DECK_MIN - total} more</span>`);
}

function renderDeckList() {
  const listEl = document.getElementById('deck-list');
  const deck = DeckStore.getActiveDeck();
  if (!deck) { listEl.innerHTML = ''; return; }

  const ids = Object.keys(deck.cards).sort((a, b) => a.localeCompare(b));
  if (ids.length === 0) {
    listEl.innerHTML = '<li class="library-empty">Empty deck — add cards from your collection on the left.</li>';
    return;
  }

  // One row per copy, mirroring the in-game deck list (no per-card compiling).
  const scroll = listEl.scrollTop;
  let seq = 0;
  const rows = [];
  for (const id of ids) {
    const card = state.cardsById.get(id);
    const count = deck.cards[id];
    const owned = DeckStore.getOwned(id);
    for (let copy = 0; copy < count; copy++) {
      seq++;
      // Within a card's copies, the first `owned` are covered; extras are flagged.
      const flag = copy < owned
        ? '<span class="own-flag ok">✓ owned</span>'
        : '<span class="own-flag warn">not owned</span>';
      rows.push(`
        <li class="library-row deck-row">
          <span class="row-seq">${String(seq).padStart(2, '0')}</span>
          <span class="row-id">#${escapeHtml(id)}</span>
          <span class="row-name">${escapeHtml(card ? card.name : id)}</span>
          ${flag}
          <button type="button" class="del-btn" data-action="deck-remove-one" data-id="${escapeHtml(id)}" aria-label="Remove one copy of ${escapeHtml(card ? card.name : id)}">&times;</button>
        </li>`);
    }
  }
  listEl.innerHTML = rows.join('');
  listEl.scrollTop = scroll;
}

/* ── Sync ────────────────────────────────────────────────────────────────── */

function setSyncStatus(msg) { document.getElementById('sync-status').textContent = msg; }

async function initSync() {
  try { await DriveSync.init(APP_CONFIG.googleClientId, APP_CONFIG.appKey); }
  catch { /* GIS load / config issues surface in the status line below */ }
  updateSyncButtons();
  renderSyncStatus();
}

function updateSyncButtons() {
  const configured = DriveSync.configured();
  const signedIn = configured && DriveSync.isSignedIn();
  const el = (id) => document.getElementById(id);
  el('sync-signin').hidden = signedIn;
  el('sync-signin').disabled = !configured;
  el('sync-signout').hidden = !signedIn;
  el('sync-push').disabled = !signedIn;
  el('sync-pull').disabled = !signedIn;
}

function renderSyncStatus() {
  const el = document.getElementById('sync-status');
  if (el.dataset.busy) return;
  if (!DriveSync.configured()) { el.textContent = 'Google sync not configured.'; return; }
  const meta = DeckStore.getSyncMeta();
  const bits = [DriveSync.isSignedIn() ? 'signed in ✓' : 'not signed in'];
  if (meta.lastPush) bits.push('pushed ' + new Date(meta.lastPush).toLocaleString());
  if (meta.lastPull) bits.push('pulled ' + new Date(meta.lastPull).toLocaleString());
  el.textContent = bits.join(' · ');
}

async function doSignIn() {
  setSyncStatus('Opening Google sign-in…');
  try { await DriveSync.signIn(); setSyncStatus('Signed in.'); }
  catch (e) { setSyncStatus('Sign-in failed: ' + e.message); }
  updateSyncButtons();
}

function doSignOut() {
  DriveSync.signOut();
  updateSyncButtons();
  setSyncStatus('Signed out.');
}

// Empty = nothing owned AND every deck has no cards. Used to warn before a push
// clobbers real Drive data with a blank slate (the classic sync accident).
function isBlobEmpty(blob) {
  const noOwned = !blob.collection || Object.keys(blob.collection).length === 0;
  const noDeckCards = !blob.decks || blob.decks.every((d) => !d.cards || Object.keys(d.cards).length === 0);
  return noOwned && noDeckCards;
}

async function runSync(dir) {
  // Confirm the (destructive, one-directional) action before touching Drive.
  if (dir === 'push') {
    const blob = DeckStore.getSyncBlob();
    const msg = isBlobEmpty(blob)
      ? 'Push an EMPTY collection & decks to your Google Drive?\n\nThis overwrites whatever is already saved there and cannot be undone. If your Drive has data you want, use Pull instead.'
      : 'Push: overwrite the copy in your Google Drive with the data on THIS device?\n\nThe current Drive copy will be replaced.';
    if (!window.confirm(msg)) { setSyncStatus('Cancelled.'); return; }
  } else if (dir === 'pull') {
    if (!window.confirm('Pull: overwrite the data on THIS device with the copy from your Google Drive?\n\nUnsaved local changes will be replaced.')) {
      setSyncStatus('Cancelled.');
      return;
    }
  }

  const btns = ['sync-push', 'sync-pull', 'sync-signin', 'sync-signout'].map((id) => document.getElementById(id));
  const statusEl = document.getElementById('sync-status');
  btns.forEach((b) => (b.disabled = true));
  statusEl.dataset.busy = '1';
  setSyncStatus(dir === 'push' ? 'Pushing…' : 'Pulling…');
  let msg;
  try {
    if (dir === 'push') { await DriveSync.push(DeckStore.getSyncBlob()); DeckStore.setSyncMeta({ lastPush: new Date().toISOString() }); }
    else { DeckStore.importData(await DriveSync.pull()); DeckStore.setSyncMeta({ lastPull: new Date().toISOString() }); }
    msg = (dir === 'push' ? 'Pushed ' : 'Pulled ') + new Date().toLocaleTimeString();
  } catch (err) {
    msg = 'Error: ' + err.message;
  } finally {
    delete statusEl.dataset.busy;
    updateSyncButtons();
    setSyncStatus(msg);
  }
}

/* ── Export / Import ─────────────────────────────────────────────────────── */

function exportFile() {
  const blob = new Blob([DeckStore.exportData()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fm-tools-decks.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      DeckStore.importData(JSON.parse(reader.result));
      setSyncStatus('Imported ' + file.name);
    } catch (err) {
      setSyncStatus('Import failed: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

/* ── Render orchestration ────────────────────────────────────────────────── */

function renderAll() {
  renderCollection();
  renderDeckHead();
  renderDeckList();
  updateSyncButtons();
  renderSyncStatus();
}
