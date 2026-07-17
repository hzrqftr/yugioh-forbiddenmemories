// Deck Builder UI. Left = collection (own 0–3 per card); right = active deck
// (owned-aware, not enforced). All state flows through DeckStore.

const CARD_TYPES = ['All', 'Monster', 'Magic', 'Trap', 'Ritual', 'Equip', 'Field'];
const SORT_FIELDS = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'atk', label: 'ATK' },
  { key: 'def', label: 'DEF' },
];
const DECK_SIZE = 40; // FM caps a deck at exactly 40 cards (no more than 40)
const MEMBERSHIP = [
  { key: 'all', label: 'All cards' },
  { key: 'deck', label: 'In deck' },
  { key: 'trunk', label: 'In trunk' },
  { key: 'owned', label: 'Owned' },
];
const CAN_HOVER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const dbState = { query: '', typeFilter: 'All', sortBy: 'id', sortDir: 'asc', membership: 'all' };
let allCards = [];
let currentAdvice = { adviceById: new Map(), suggestions: [], counts: { adds: 0, swaps: 0 }, weakestDeckId: null };
let cardTip = null;

init();

async function init() {
  try {
    await loadCoreData();
  } catch (err) {
    document.getElementById('deck-list').innerHTML = `<li class="library-empty">Failed to load card data: ${escapeHtml(err.message)}</li>`;
    return;
  }

  allCards = [...state.cardsById.values()].sort((a, b) => a.id.localeCompare(b.id));
  DeckAdvisor.buildIndex();
  DeckStore.ensureDeck();

  buildTypeSelect();
  buildMembershipSelect();
  buildSortControls();
  wireEvents();
  setupTooltip();
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

  document.getElementById('suggest-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const deck = DeckStore.getActiveDeck();
    if (!deck) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'suggest-add') {
      addToDeck(id);
    } else if (btn.dataset.action === 'suggest-replace') {
      const target = btn.dataset.target;
      if (target) DeckStore.setDeckCard(deck.id, target, (deck.cards[target] || 0) - 1);
      DeckStore.setDeckCard(deck.id, id, (deck.cards[id] || 0) + 1);
    }
  });
}

function addToDeck(id) {
  const deck = DeckStore.getActiveDeck();
  if (!deck) return;
  if (DeckStore.deckTotal(deck) >= DECK_SIZE) return; // hard cap: no more than 40
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

function buildMembershipSelect() {
  const sel = document.getElementById('collection-view');
  sel.innerHTML = MEMBERSHIP
    .map((m) => `<option value="${m.key}"${m.key === dbState.membership ? ' selected' : ''}>${m.label}</option>`)
    .join('');
  sel.addEventListener('change', () => { dbState.membership = sel.value; renderCollectionTop(); });
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
  const deck = DeckStore.getActiveDeck();
  const filtered = allCards.filter((c) => {
    if (dbState.typeFilter !== 'All' && c.cardType !== dbState.typeFilter) return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    if (dbState.membership !== 'all') {
      const owned = DeckStore.getOwned(c.id);
      const inDeck = deck ? (deck.cards[c.id] || 0) : 0;
      if (dbState.membership === 'deck' && inDeck === 0) return false;         // in the deck
      if (dbState.membership === 'trunk' && !(owned > 0 && inDeck === 0)) return false; // owned, not in deck
      if (dbState.membership === 'owned' && owned === 0) return false;          // owned (any)
    }
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
  const deckFull = activeDeck ? DeckStore.deckTotal(activeDeck) >= DECK_SIZE : false;
  const scroll = listEl.scrollTop;
  listEl.innerHTML = cards.map((c) => {
    const owned = DeckStore.getOwned(c.id);
    const inDeck = activeDeck ? (activeDeck.cards[c.id] || 0) : 0;
    // Deck membership takes precedence; otherwise flag cards owned but unused.
    let tag = '';
    if (inDeck) tag = `<span class="in-deck-tag" title="${inDeck} in the current deck">in deck ×${inDeck}</span>`;
    else if (owned) tag = `<span class="in-trunk-tag" title="${owned} owned, not in the current deck">in trunk ×${owned}</span>`;
    // Advisor badge for owned-but-unused monsters (strong add / better replacement).
    let badge = '';
    if (!inDeck && owned) {
      const adv = currentAdvice.adviceById.get(c.id);
      if (adv && (adv.category === 'strong' || adv.category === 'replace')) {
        const icon = adv.category === 'strong' ? '⭐' : '🔁';
        badge = `<span class="advice-badge ${adv.category}" title="${escapeHtml(adv.label + ' — ' + adv.reason)}">${icon}</span>`;
      }
    }
    return `
      <li class="library-row deck-row${inDeck ? ' in-deck' : ''}">
        <span class="row-id">#${escapeHtml(c.id)}</span>
        <span class="row-name">${escapeHtml(c.name)}</span>
        ${tag}${badge}
        <span class="qty-stepper" role="group" aria-label="Owned quantity">
          <button type="button" class="qty-btn" data-action="own-dec" data-id="${escapeHtml(c.id)}" ${owned === 0 ? 'disabled' : ''} aria-label="Own one fewer">&minus;</button>
          <span class="qty-val${owned ? ' has' : ''}">${owned}</span>
          <button type="button" class="qty-btn" data-action="own-inc" data-id="${escapeHtml(c.id)}" ${owned >= DeckStore.MAX_COPIES ? 'disabled' : ''} aria-label="Own one more">+</button>
        </span>
        <button type="button" class="add-deck-btn" data-action="add-deck" data-id="${escapeHtml(c.id)}" ${deckFull ? 'disabled' : ''} title="${deckFull ? 'Deck is full (40)' : 'Add to deck'}" aria-label="Add to deck">+deck</button>
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
  let cls, note;
  if (total > DECK_SIZE) { cls = ' over'; note = `over by ${total - DECK_SIZE} — remove some`; }
  else if (total === DECK_SIZE) { cls = ' ok'; note = 'deck full'; }
  else { cls = ' under'; note = `need ${DECK_SIZE - total} more`; }
  meter.className = 'deck-meter' + cls;
  meter.innerHTML = `<span class="meter-count">${total} / ${DECK_SIZE}</span><span class="meter-note">${note}</span>`;
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
  currentAdvice = DeckAdvisor.analyze(DeckStore.getActiveDeck(), DeckStore.getCollection());
  renderCollection();
  renderDeckHead();
  renderDeckList();
  renderSuggestions();
  updateSyncButtons();
  renderSyncStatus();
}

/* ── Suggestions panel ───────────────────────────────────────────────────── */

function renderSuggestions() {
  const summary = document.getElementById('suggest-summary');
  const listEl = document.getElementById('suggest-list');
  if (!summary || !listEl) return;
  const { suggestions, counts } = currentAdvice;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  summary.textContent = `suggestions · ${plural(counts.adds, 'add')} · ${plural(counts.swaps, 'swap')}`;

  if (!suggestions.length) {
    listEl.innerHTML = '<li class="suggest-empty">Own cards outside this deck to get suggestions.</li>';
    return;
  }
  listEl.innerHTML = suggestions.map((s) => {
    const action = s.category === 'replace'
      ? `<button type="button" class="secondary suggest-act" data-action="suggest-replace" data-id="${escapeHtml(s.id)}" data-target="${escapeHtml(s.targetId)}">Swap in</button>`
      : `<button type="button" class="secondary suggest-act" data-action="suggest-add" data-id="${escapeHtml(s.id)}">Add</button>`;
    return `
      <li class="suggest-row">
        <span class="suggest-verdict ${s.category}">${s.label}</span>
        <span class="suggest-main">
          <span class="suggest-name">#${escapeHtml(s.id)} ${escapeHtml(s.name)}</span>
          <span class="suggest-reason">${escapeHtml(s.reason)}</span>
        </span>
        ${action}
      </li>`;
  }).join('');
}

/* ── Hover popover (desktop only) — deck-contextual card detail ───────────── */

function setupTooltip() {
  if (!CAN_HOVER) return;
  cardTip = document.createElement('div');
  cardTip.className = 'card-tip deck-tip';
  cardTip.hidden = true;
  document.body.appendChild(cardTip);

  ['collection-list', 'deck-list'].forEach((listId) => {
    const el = document.getElementById(listId);
    if (!el) return;
    el.addEventListener('mouseover', (e) => {
      const row = e.target.closest('li');
      if (row && el.contains(row)) showTip(row);
    });
    el.addEventListener('mouseout', (e) => {
      const row = e.target.closest('li');
      if (row && (!e.relatedTarget || !row.contains(e.relatedTarget))) hideTip();
    });
  });
  window.addEventListener('scroll', hideTip, true);
}

function rowCardId(row) {
  const el = row.querySelector('[data-id]');
  return el ? el.dataset.id : null;
}

function tipHtml(id) {
  const card = state.cardsById.get(id);
  if (!card) return '';
  const isMonster = card.cardType === 'Monster';
  const img = state.cardImagesById.get(id);
  const thumb = img && img.localPath
    ? `<img class="tip-thumb" src="${escapeHtml(img.localPath)}" alt="">`
    : '';
  const statLine = isMonster
    ? `${escapeHtml(card.monsterType)} · Lv ${escapeHtml(card.level)} · ATK ${escapeHtml(card.atk)} / DEF ${escapeHtml(card.def)}`
    : `${escapeHtml(card.cardType)} · utility card`;

  const rows = [];
  if (isMonster && card.gsA) {
    const beats = [DeckAdvisor.starBeats(card.gsA), DeckAdvisor.starBeats(card.gsB)].filter(Boolean);
    rows.push(`<span class="tip-gs">★ ${escapeHtml(card.gsA)} / ${escapeHtml(card.gsB)}${beats.length ? ` · beats ${escapeHtml(beats.join(', '))}` : ''}</span>`);
  }
  if (card.desc) rows.push(`<span class="tip-desc">${escapeHtml(card.desc)}</span>`);

  const owned = DeckStore.getOwned(id);
  const deck = DeckStore.getActiveDeck();
  const inDeck = deck ? (deck.cards[id] || 0) : 0;
  rows.push(`<span class="tip-row">Owned ×${owned} · In deck ×${inDeck}</span>`);

  if (isMonster) {
    const fs = DeckAdvisor.fusionSummary(id, deck);
    if (fs.partnerCount > 0 && fs.resultId) {
      const res = state.cardsById.get(fs.resultId);
      const partner = state.cardsById.get(fs.partnerId);
      rows.push(`<span class="tip-row">Fuses with ${fs.partnerCount} deck card${fs.partnerCount === 1 ? '' : 's'} → ${escapeHtml(res ? res.name : '?')} (${res ? escapeHtml(res.atk) : '?'} ATK) with ${escapeHtml(partner ? partner.name : '?')}</span>`);
    } else {
      rows.push('<span class="tip-row">No fusions with your current deck.</span>');
    }
  }

  // Verdict / standing line.
  let verdict;
  if (!isMonster) {
    verdict = 'utility card — judge manually';
  } else if (inDeck > 0) {
    verdict = id === currentAdvice.weakestDeckId ? '⚠ weakest monster in your deck' : 'in your deck';
  } else {
    const adv = currentAdvice.adviceById.get(id);
    verdict = adv ? `${adv.label} — ${adv.reason}` : '';
  }
  if (verdict) rows.push(`<span class="tip-verdict">${escapeHtml(verdict)}</span>`);

  return `
    <div class="tip-head">
      ${thumb}
      <div class="tip-headtext">
        <span class="tip-name">${escapeHtml(card.name)}</span>
        <span class="tip-stat">#${escapeHtml(card.id)} · ${statLine}</span>
      </div>
    </div>
    ${rows.join('')}`;
}

function showTip(row) {
  const id = rowCardId(row);
  if (!id || !cardTip) return;
  const html = tipHtml(id);
  if (!html) return;
  cardTip.innerHTML = html;
  cardTip.hidden = false;

  const r = row.getBoundingClientRect();
  const tipW = cardTip.offsetWidth;
  let left = Math.min(r.left, window.innerWidth - tipW - 8);
  left = Math.max(8, left);
  cardTip.style.left = left + 'px';
  if (r.top > window.innerHeight / 2) {
    cardTip.style.top = (r.top - 8) + 'px';
    cardTip.style.transform = 'translateY(-100%)';
  } else {
    cardTip.style.top = (r.bottom + 8) + 'px';
    cardTip.style.transform = 'none';
  }
}

function hideTip() {
  if (cardTip) cardTip.hidden = true;
}
